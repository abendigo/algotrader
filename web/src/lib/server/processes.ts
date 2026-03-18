/**
 * Server-side process manager for live trading sessions and backtests.
 *
 * Live sessions are managed via a per-user service process that shares a single
 * OANDA streaming connection. The web app communicates with the service via HTTP.
 * If no service is running, one is spawned automatically.
 *
 * Backtests remain in-memory managed (they're short-lived).
 */

import { spawn } from "child_process";
import { join } from "path";
import { readFileSync, existsSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { ServiceClient, getServiceClient, readServiceDiscovery } from "../../../../src/live/service-client.js";
import type { SessionFile } from "../../../../src/live/session-manager.js";

const PROJECT_ROOT = join(import.meta.dirname, "../../../..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const TSX = join(PROJECT_ROOT, "node_modules/.bin/tsx");

// --- Session file helpers ---

function getSessionsDir(userId: string): string {
  return join(DATA_DIR, "users", userId, "live-sessions");
}

// --- Live session management (via per-user service) ---

export interface LiveConfig {
  units?: number;
  stopRangeFraction?: number;
  skipDays?: number[];
  trailActivateFraction?: number;
  trailDistanceFraction?: number;
  instruments?: string;
}

/**
 * Get or spawn a service for a user.
 * Returns a ServiceClient ready to use, or null on failure.
 */
async function ensureService(userId: string, userEmail: string): Promise<ServiceClient | null> {
  // Check for existing service
  let client = await getServiceClient(userId);
  if (client) return client;

  // Spawn a new service process
  const serviceArgs = [
    join(PROJECT_ROOT, "src/live/service.ts"),
    `--user=${userEmail}`,
  ];

  const child = spawn("caffeinate", ["-i", TSX, ...serviceArgs], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  child.stdout?.on("data", () => {}); // drain
  child.stderr?.on("data", () => {}); // drain
  child.unref();

  // Poll for discovery file (max 5s)
  const discoveryPath = join(DATA_DIR, "users", userId, "live-service.json");
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (existsSync(discoveryPath)) {
      client = await getServiceClient(userId);
      if (client) return client;
    }
  }

  return null;
}

export async function startLive(
  userId: string,
  userEmail: string,
  accountId: string,
  strategy: string,
  config: LiveConfig = {},
): Promise<{ success: boolean; error?: string }> {
  const client = await ensureService(userId, userEmail);
  if (!client) {
    return { success: false, error: "Failed to start live trading service" };
  }

  try {
    const result = await client.startSession(accountId, strategy, {
      units: config.units ?? 100,
      ...config,
    });
    if (result.ok) {
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function stopLive(
  userId: string,
  accountId: string,
): Promise<{ success: boolean; error?: string }> {
  const client = await getServiceClient(userId);
  if (!client) {
    return { success: false, error: "No live trading service running" };
  }

  try {
    // Find the session for this account
    const sessions = await client.getSessions();
    const active = sessions.find((s) => s.accountId === accountId && s.status === "running");
    if (!active) {
      return { success: false, error: "No running session for this account" };
    }

    const result = await client.stopSession(active.sessionId);
    return { success: result.ok, error: result.error };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function stopLiveBySessionId(
  userId: string,
  sessionId: string,
): Promise<{ success: boolean; error?: string }> {
  const client = await getServiceClient(userId);
  if (!client) {
    return { success: false, error: "No live trading service running" };
  }

  try {
    const result = await client.stopSession(sessionId);
    return { success: result.ok, error: result.error };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function discoverSessions(userId: string): Promise<SessionFile[]> {
  // Try service client first
  const client = await getServiceClient(userId);
  if (client) {
    try {
      return await client.getSessions();
    } catch { /* fall through to file scan */ }
  }

  // Fallback: read session files directly (service may be down)
  return discoverSessionsFromFiles(userId);
}

function discoverSessionsFromFiles(userId: string): SessionFile[] {
  const sessionsDir = getSessionsDir(userId);
  if (!existsSync(sessionsDir)) return [];

  const results: SessionFile[] = [];
  for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
    try {
      const session = JSON.parse(readFileSync(join(sessionsDir, file), "utf-8")) as SessionFile;
      results.push(session);
    } catch {
      // skip malformed files
    }
  }

  return results;
}

export function cleanSession(userId: string, sessionId: string): boolean {
  const sessionsDir = getSessionsDir(userId);
  const filePath = join(sessionsDir, `${sessionId}.json`);
  if (!existsSync(filePath)) return false;

  try {
    const session = JSON.parse(readFileSync(filePath, "utf-8")) as SessionFile;
    // Only clean non-running sessions
    if (session.status === "running" || session.status === "starting") return false;
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// --- Backtest management (unchanged — in-memory, short-lived) ---

export interface BacktestProcess {
  id: string;
  userId: string;
  strategy: string;
  granularity: string;
  startedAt: string;
  output: string[];
  status: "running" | "done" | "error";
  exitCode?: number | null;
}

const MAX_OUTPUT_LINES = 200;
const backtests = new Map<string, BacktestProcess>();
let backtestCounter = 0;

export interface BacktestOptions {
  spreadMult?: number;
  execDelay?: number;
  entryDelay?: number;
  timeVaryingSpread?: boolean;
  slippage?: number;
  fromDate?: string;
  toDate?: string;
  reward?: number;
  pairs?: string;
  balance?: number;
  strategyConfig?: Record<string, unknown>;
}

export function startBacktest(
  userId: string,
  userEmail: string,
  strategy: string,
  granularity: string,
  options: BacktestOptions = {},
): { success: boolean; error?: string; backtestId?: string } {
  const args = [
    join(PROJECT_ROOT, "src/backtest/run.ts"),
    strategy,
    granularity,
    `--user=${userEmail}`,
  ];

  if (options.spreadMult && options.spreadMult !== 1) args.push(`--spread-mult=${options.spreadMult}`);
  if (options.execDelay) args.push(`--exec-delay=${options.execDelay}`);
  if (options.entryDelay) args.push(`--entry-delay=${options.entryDelay}`);
  if (options.timeVaryingSpread) args.push("--time-varying-spread");
  if (options.slippage) args.push(`--slippage=${options.slippage}`);
  if (options.fromDate) args.push(`--from=${options.fromDate}`);
  if (options.toDate) args.push(`--to=${options.toDate}`);
  if (options.reward) args.push(`--reward=${options.reward}`);
  if (options.pairs) args.push(`--pairs=${options.pairs}`);
  if (options.balance) args.push(`--balance=${options.balance}`);

  // Forward strategy-specific config fields as CLI flags
  if (options.strategyConfig) {
    const flagMap: Record<string, string> = {
      units: "--units",
      stopRangeFraction: "--stop-frac",
      skipDays: "--skip-days",
      trailActivateFraction: "--trail-activate",
      trailDistanceFraction: "--trail-dist",
      rewardRatio: "--reward",
      instruments: "--pairs",
      entryDelay: "--entry-delay",
    };
    for (const [key, value] of Object.entries(options.strategyConfig)) {
      if (value == null || value === "" || value === 0) continue;
      const flag = flagMap[key];
      if (flag) args.push(`${flag}=${value}`);
    }
  }

  const child = spawn(TSX, args, {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const id = `bt-${++backtestCounter}`;
  const bt: BacktestProcess = {
    id,
    userId,
    strategy,
    granularity,
    startedAt: new Date().toISOString(),
    output: [],
    status: "running",
  };

  const appendOutput = (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    bt.output.push(...lines);
    if (bt.output.length > MAX_OUTPUT_LINES) {
      bt.output = bt.output.slice(-MAX_OUTPUT_LINES);
    }
  };

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  child.on("exit", (code) => {
    bt.exitCode = code;
    bt.status = code === 0 ? "done" : "error";
  });

  backtests.set(id, bt);
  return { success: true, backtestId: id };
}

export function getUserBacktests(userId: string): BacktestProcess[] {
  return [...backtests.values()].filter((b) => b.userId === userId);
}

export function clearFinishedBacktests(userId: string): void {
  for (const [id, bt] of backtests) {
    if (bt.userId === userId && bt.status !== "running") {
      backtests.delete(id);
    }
  }
}
