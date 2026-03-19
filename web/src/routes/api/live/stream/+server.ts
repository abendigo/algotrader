import type { RequestHandler } from "./$types.js";
import { eventBus } from "$lib/server/event-bus.js";
import { discoverSessions } from "$lib/server/processes.js";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "$lib/server/paths.js";

function getUserLiveDir(userId: string): string {
  return join(DATA_DIR, "users", userId, "live");
}

/** Server-side poller per user — runs only while SSE clients are connected */
const activePollers = new Map<string, { interval: ReturnType<typeof setInterval>; clients: number }>();

async function pollSessions(userId: string): Promise<void> {
  if (!eventBus.hasListeners(`live:${userId}`)) return;

  try {
    const sessionFiles = await discoverSessions(userId);
    const liveDir = getUserLiveDir(userId);
    const sessions = [];
    const sessionAccountIds = new Set<string>();

    for (const sf of sessionFiles) {
      sessionAccountIds.add(sf.accountId);
      const sessionStateFile = join(liveDir, sf.accountId, `state-${sf.sessionId}.json`);
      const legacyStateFile = join(liveDir, sf.accountId, "state.json");
      const stateFile = existsSync(sessionStateFile) ? sessionStateFile : legacyStateFile;
      let state: Record<string, unknown> = {};
      if (existsSync(stateFile)) {
        try { state = JSON.parse(readFileSync(stateFile, "utf-8")); } catch { /* ignore */ }
      }
      const isActive = sf.status === "running" || sf.status === "starting";
      const stateAge = state.timestamp ? Date.now() - new Date(state.timestamp as string).getTime() : Infinity;

      sessions.push({
        ...state,
        accountId: sf.accountId,
        accountLabel: sf.accountId,
        running: isActive,
        stale: isActive ? stateAge > 30_000 : true,
        managed: isActive,
        tickCount: (state.tickCount as number) ?? 0,
        timestamp: (state.timestamp as string) ?? sf.startedAt,
        strategyName: (state.strategyName as string) ?? (sf.status === "starting" ? "Starting..." : sf.strategy),
        sessionId: sf.sessionId,
        sessionStatus: sf.status,
        sessionError: sf.lastError,
      });
    }

    // CLI-started sessions without session files
    if (existsSync(liveDir)) {
      for (const dir of readdirSync(liveDir)) {
        if (sessionAccountIds.has(dir)) continue;
        const stateFile = join(liveDir, dir, "state.json");
        if (!existsSync(stateFile)) continue;
        try {
          const state = JSON.parse(readFileSync(stateFile, "utf-8"));
          const stateAge = Date.now() - new Date(state.timestamp).getTime();
          if (stateAge > 30_000) continue;
          state.accountId = dir;
          state.accountLabel = dir;
          state.managed = false;
          state.stale = false;
          sessions.push(state);
        } catch { /* skip */ }
      }
    }

    const activeSessions = sessions.filter((s: any) => s.managed || !s.stale);
    eventBus.emit(`live:${userId}`, { sessions: activeSessions });
  } catch { /* ignore */ }
}

function startPoller(userId: string): void {
  const existing = activePollers.get(userId);
  if (existing) {
    existing.clients++;
    return;
  }
  // Poll immediately, then every 2s
  pollSessions(userId);
  const interval = setInterval(() => pollSessions(userId), 2000);
  activePollers.set(userId, { interval, clients: 1 });
}

function stopPoller(userId: string): void {
  const existing = activePollers.get(userId);
  if (!existing) return;
  existing.clients--;
  if (existing.clients <= 0) {
    clearInterval(existing.interval);
    activePollers.delete(userId);
  }
}

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });

  const userId = locals.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      startPoller(userId);

      const unsub = eventBus.subscribe(`live:${userId}`, (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { unsub(); stopPoller(userId); }
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
          unsub();
          stopPoller(userId);
        }
      }, 30_000);

      (controller as any)._cleanup = () => {
        clearInterval(keepalive);
        unsub();
        stopPoller(userId);
      };
    },
    cancel(controller: any) {
      controller?._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
};
