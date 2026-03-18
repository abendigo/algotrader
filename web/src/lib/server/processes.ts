/**
 * Server-side process manager for live trading sessions and backtests.
 *
 * Live sessions are spawned detached via `caffeinate -i` so they survive
 * web server restarts (e.g., Vite hot-reload). Session state is tracked
 * in JSON files under data/users/{userId}/live-sessions/.
 *
 * Backtests remain in-memory managed (they're short-lived).
 */

import { spawn } from "child_process";
import { join } from "path";
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from "fs";
import type { SessionFile } from "../../../../src/live/runner.js";

const PROJECT_ROOT = join(import.meta.dirname, "../../../..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const TSX = join(PROJECT_ROOT, "node_modules/.bin/tsx");

// --- Session file helpers ---

function getSessionsDir(userId: string): string {
  return join(DATA_DIR, "users", userId, "live-sessions");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- Live session management (detached, session-file based) ---

export interface LiveConfig {
  units?: number;
  stopRangeFraction?: number;
  skipDays?: number[];
  trailActivateFraction?: number;
  trailDistanceFraction?: number;
  instruments?: string;
}

export async function startLive(
  userId: string,
  userEmail: string,
  accountId: string,
  strategy: string,
  config: LiveConfig = {},
): Promise<{ success: boolean; error?: string }> {
  // Check for existing active session on this account
  const existing = discoverSessions(userId);
  if (existing.some((s) => s.accountId === accountId && s.status === "running")) {
    return { success: false, error: "Session already running for this account" };
  }

  const sessionsDir = getSessionsDir(userId);
  if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

  const sessionId = `${accountId}-${strategy}-${Date.now()}`;
  const sessionFilePath = join(sessionsDir, `${sessionId}.json`);

  // Write initial session file
  const sessionData: SessionFile = {
    sessionId,
    pid: 0, // will be updated by runner or after spawn
    userId,
    accountId,
    strategy,
    config: { units: config.units ?? 100, ...config },
    status: "starting",
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  };
  writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2));

  // Build runner CLI args
  const runnerArgs = [
    join(PROJECT_ROOT, "src/live/runner.ts"),
    `--user=${userEmail}`,
    `--account=${accountId}`,
    `--strategy=${strategy}`,
    `--session-file=${sessionFilePath}`,
  ];

  const units = config.units ?? 100;
  runnerArgs.push(`--units=${units}`);
  if (config.stopRangeFraction != null) runnerArgs.push(`--stop-frac=${config.stopRangeFraction}`);
  if (config.skipDays != null && config.skipDays.length > 0) runnerArgs.push(`--skip-days=${config.skipDays.join(",")}`);
  if (config.trailActivateFraction != null) runnerArgs.push(`--trail-activate=${config.trailActivateFraction}`);
  if (config.trailDistanceFraction != null) runnerArgs.push(`--trail-dist=${config.trailDistanceFraction}`);
  if (config.instruments) runnerArgs.push(`--pairs=${config.instruments}`);

  // Spawn detached via caffeinate to survive server restarts and prevent idle sleep
  const child = spawn("caffeinate", ["-i", TSX, ...runnerArgs], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  // Update session file with actual PID
  if (child.pid) {
    sessionData.pid = child.pid;
    writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2));
  }

  // Collect early output for error detection
  const earlyOutput: string[] = [];
  const appendOutput = (data: Buffer) => {
    earlyOutput.push(...data.toString().split("\n").filter(Boolean));
  };
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  // Wait briefly for early failures
  const earlyExit = await Promise.race([
    new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code))),
    new Promise<"running">((resolve) => setTimeout(() => resolve("running"), 3000)),
  ]);

  if (earlyExit !== "running") {
    // Process died early — read session file for error, or use output
    let error = "Process exited immediately";
    try {
      const updated = JSON.parse(readFileSync(sessionFilePath, "utf-8")) as SessionFile;
      if (updated.error) error = updated.error;
      else {
        const errorLine = earlyOutput.findLast((l) => l.includes("Error:"));
        if (errorLine) error = errorLine;
      }
    } catch { /* ignore */ }
    return { success: false, error };
  }

  // Detach — let the process live independently
  child.stdout?.removeAllListeners("data");
  child.stderr?.removeAllListeners("data");
  child.unref();

  return { success: true };
}

export function stopLive(
  userId: string,
  accountId: string,
): { success: boolean; error?: string } {
  const sessions = discoverSessions(userId);
  const active = sessions.find((s) => s.accountId === accountId && s.status === "running");
  if (!active) {
    return { success: false, error: "No running session for this account" };
  }

  try {
    process.kill(active.pid, "SIGTERM");
    return { success: true };
  } catch {
    return { success: false, error: "Failed to send stop signal (process may already be dead)" };
  }
}

export function discoverSessions(userId: string): SessionFile[] {
  const sessionsDir = getSessionsDir(userId);
  if (!existsSync(sessionsDir)) return [];

  const results: SessionFile[] = [];
  for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
    try {
      const session = JSON.parse(readFileSync(join(sessionsDir, file), "utf-8")) as SessionFile;

      // If session claims to be running/starting, verify PID is alive
      if ((session.status === "running" || session.status === "starting") && session.pid > 0) {
        if (!isPidAlive(session.pid)) {
          session.status = "error";
          session.error = "Process died unexpectedly";
          writeFileSync(join(sessionsDir, file), JSON.stringify(session, null, 2));
        }
      }

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
