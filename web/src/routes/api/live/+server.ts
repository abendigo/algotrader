import { json } from "@sveltejs/kit";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type { RequestHandler } from "./$types.js";
import { isRunning, getUserSessions } from "$lib/server/processes.js";

const DATA_DIR = join(import.meta.dirname, "../../../../../data");

function getUserLiveDir(userId: string): string {
  return join(DATA_DIR, "users", userId, "live");
}

export const GET: RequestHandler = ({ url, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not authenticated" }, { status: 401 });

  const type = url.searchParams.get("type") ?? "sessions";
  const accountId = url.searchParams.get("account");

  if (type === "sessions") {
    // Discover all active sessions for this user
    const liveDir = getUserLiveDir(user.id);
    if (!existsSync(liveDir)) return json([]);

    const sessions = [];
    for (const dir of readdirSync(liveDir)) {
      const stateFile = join(liveDir, dir, "state.json");
      if (!existsSync(stateFile)) continue;

      try {
        const state = JSON.parse(readFileSync(stateFile, "utf-8"));
        const stateAge = Date.now() - new Date(state.timestamp).getTime();
        state.stale = stateAge > 30_000;
        state.accountId = dir;
        state.accountLabel = dir;
        state.managed = isRunning(user.id, dir);

        sessions.push(state);
      } catch {
        // skip malformed state files
      }
    }

    // Include managed processes that have no state file yet (e.g., still starting up)
    const sessionAccountIds = new Set(sessions.map((s: any) => s.accountId));
    for (const managed of getUserSessions(user.id)) {
      if (!sessionAccountIds.has(managed.accountId)) {
        sessions.push({
          accountId: managed.accountId,
          accountLabel: managed.accountId,
          running: true,
          stale: false,
          managed: true,
          tickCount: 0,
          timestamp: managed.startedAt,
          strategyName: "Starting...",
        });
      }
    }

    // Only return sessions that are either actively managed or recently updated
    const activeSessions = sessions.filter(
      (s: any) => s.managed || !s.stale,
    );
    return json(activeSessions);
  }

  if (type === "state") {
    if (!accountId) return json({ error: "account param required" }, { status: 400 });

    const stateFile = join(getUserLiveDir(user.id), accountId, "state.json");
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

    const dateStr = new Date().toISOString().slice(0, 10);
    const logFile = join(getUserLiveDir(user.id), accountId, `${dateStr}.jsonl`);
    if (!existsSync(logFile)) return json([]);

    const lines = readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const trades = entries.filter(
      (e: any) => e.type === "start" || e.type === "trade" || e.type === "exit" || e.type === "stop" || e.type === "status"
    );
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
