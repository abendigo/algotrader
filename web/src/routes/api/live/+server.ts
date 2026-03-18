import { json } from "@sveltejs/kit";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type { RequestHandler } from "./$types.js";
import { discoverSessions, cleanSession } from "$lib/server/processes.js";

const DATA_DIR = join(import.meta.dirname, "../../../../../data");

function getUserLiveDir(userId: string): string {
  return join(DATA_DIR, "users", userId, "live");
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not authenticated" }, { status: 401 });

  const type = url.searchParams.get("type") ?? "sessions";
  const accountId = url.searchParams.get("account");

  if (type === "sessions") {
    // Discover sessions from service (or fallback to session files) + state.json for display info
    const sessionFiles = await discoverSessions(user.id);
    const liveDir = getUserLiveDir(user.id);

    const sessions = [];

    // Build a set of accounts with active session files
    const sessionAccountIds = new Set<string>();

    for (const sf of sessionFiles) {
      sessionAccountIds.add(sf.accountId);

      // Try to enrich with per-session state file, fall back to legacy state.json
      const sessionStateFile = join(liveDir, sf.accountId, `state-${sf.sessionId}.json`);
      const legacyStateFile = join(liveDir, sf.accountId, "state.json");
      const stateFile = existsSync(sessionStateFile) ? sessionStateFile : legacyStateFile;
      let state: Record<string, unknown> = {};
      if (existsSync(stateFile)) {
        try {
          state = JSON.parse(readFileSync(stateFile, "utf-8"));
        } catch { /* ignore */ }
      }

      const isActive = sf.status === "running" || sf.status === "starting";
      const stateAge = state.timestamp
        ? Date.now() - new Date(state.timestamp as string).getTime()
        : Infinity;

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
        sessionError: sf.error,
      });
    }

    // Also pick up accounts with state.json but no session file (e.g., CLI-started without session file)
    if (existsSync(liveDir)) {
      for (const dir of readdirSync(liveDir)) {
        if (sessionAccountIds.has(dir)) continue;
        const stateFile = join(liveDir, dir, "state.json");
        if (!existsSync(stateFile)) continue;

        try {
          const state = JSON.parse(readFileSync(stateFile, "utf-8"));
          const stateAge = Date.now() - new Date(state.timestamp).getTime();
          if (stateAge > 30_000) continue; // skip stale sessions without session files
          state.accountId = dir;
          state.accountLabel = dir;
          state.managed = false;
          state.stale = false;
          sessions.push(state);
        } catch { /* skip */ }
      }
    }

    // Only return active or recently-active sessions
    const activeSessions = sessions.filter(
      (s: any) => s.managed || !s.stale,
    );
    return json(activeSessions);
  }

  if (type === "state") {
    if (!accountId) return json({ error: "account param required" }, { status: 400 });

    const strategy = url.searchParams.get("strategy");
    const accountDir = join(getUserLiveDir(user.id), accountId);
    const strategyStateFile = strategy ? join(accountDir, `state-${strategy}.json`) : null;
    const legacyStateFile = join(accountDir, "state.json");
    const stateFile = (strategyStateFile && existsSync(strategyStateFile))
      ? strategyStateFile
      : legacyStateFile;

    if (!existsSync(stateFile)) {
      return json({ running: false, message: "Live runner not active" });
    }
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    const stateAge = Date.now() - new Date(state.timestamp).getTime();
    state.stale = stateAge > 30_000;
    return json(state);
  }

  if (type === "log") {
    if (!accountId) return json({ error: "account param required" }, { status: 400 });

    const sessionIdFilter = url.searchParams.get("sessionId");
    const dateStr = new Date().toISOString().slice(0, 10);
    const logFile = join(getUserLiveDir(user.id), accountId, `${dateStr}.jsonl`);
    if (!existsSync(logFile)) return json([]);

    const lines = readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    let trades = entries.filter(
      (e: any) => e.type === "start" || e.type === "trade" || e.type === "exit" || e.type === "stop" || e.type === "status"
    );

    // Filter to specific session if requested
    if (sessionIdFilter) {
      trades = trades.filter((e: any) => e.sessionId === sessionIdFilter);
    }

    return json(trades);
  }

  if (type === "logs") {
    if (!accountId) return json({ error: "account param required" }, { status: 400 });

    const accountDir = join(getUserLiveDir(user.id), accountId);
    if (!existsSync(accountDir)) return json([]);
    const files = readdirSync(accountDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""))
      .sort()
      .reverse();
    return json(files);
  }

  return json({ error: "Unknown type" }, { status: 400 });
};
