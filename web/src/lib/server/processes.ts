/**
 * Server-side process manager for live trading sessions and backtests.
 * Spawns child processes and tracks them by userId + accountId.
 */

import { spawn, type ChildProcess } from "child_process";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dirname, "../../../..");
const TSX = join(PROJECT_ROOT, "node_modules/.bin/tsx");

interface ManagedProcess {
  process: ChildProcess;
  userId: string;
  accountId: string;
  type: "live" | "backtest";
  startedAt: string;
  output: string[]; // last N lines of combined stdout/stderr
}

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
const processes = new Map<string, ManagedProcess>();
const backtests = new Map<string, BacktestProcess>();
let backtestCounter = 0;

function key(userId: string, accountId: string): string {
  return `${userId}:${accountId}`;
}

export async function startLive(
  userId: string,
  userEmail: string,
  accountId: string,
  strategy: string,
  units: number = 100,
): Promise<{ success: boolean; error?: string }> {
  const k = key(userId, accountId);
  if (processes.has(k)) {
    return { success: false, error: "Session already running for this account" };
  }

  const child = spawn(TSX, [
    join(PROJECT_ROOT, "src/live/runner.ts"),
    `--user=${userEmail}`,
    `--account=${accountId}`,
    `--strategy=${strategy}`,
    `--units=${units}`,
  ], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const managed: ManagedProcess = {
    process: child,
    userId,
    accountId,
    type: "live",
    startedAt: new Date().toISOString(),
    output: [],
  };

  const appendOutput = (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    managed.output.push(...lines);
    if (managed.output.length > MAX_OUTPUT_LINES) {
      managed.output = managed.output.slice(-MAX_OUTPUT_LINES);
    }
  };

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  child.on("exit", () => {
    processes.delete(k);
  });

  processes.set(k, managed);

  // Wait briefly for early failures (e.g., hedging incompatibility, bad credentials).
  // If the process exits within this window, surface the error to the caller.
  const earlyExit = await Promise.race([
    new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code))),
    new Promise<"running">((resolve) => setTimeout(() => resolve("running"), 3000)),
  ]);

  if (earlyExit !== "running") {
    processes.delete(k);
    const stderr = managed.output.join("\n");
    // Extract the meaningful error message (last line with "Error:")
    const errorLine = managed.output.findLast((l) => l.includes("Error:"));
    return { success: false, error: errorLine || stderr || "Process exited immediately" };
  }

  return { success: true };
}

export function stopLive(
  userId: string,
  accountId: string,
): { success: boolean; error?: string } {
  const k = key(userId, accountId);
  const managed = processes.get(k);
  if (!managed) {
    return { success: false, error: "No running session for this account" };
  }

  // Send SIGTERM for graceful shutdown (closes positions)
  managed.process.kill("SIGTERM");
  return { success: true };
}

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

export function getRunningSession(userId: string, accountId: string): ManagedProcess | null {
  return processes.get(key(userId, accountId)) ?? null;
}

export function getUserSessions(userId: string): ManagedProcess[] {
  return [...processes.values()].filter((p) => p.userId === userId);
}

export function isRunning(userId: string, accountId: string): boolean {
  return processes.has(key(userId, accountId));
}

// Clean up all child processes on server exit.
// Use "exit" instead of SIGINT/SIGTERM to avoid interfering with Vite's shutdown.
process.on("exit", () => {
  for (const [, managed] of processes) {
    try { managed.process.kill("SIGTERM"); } catch { /* already dead */ }
  }
});
