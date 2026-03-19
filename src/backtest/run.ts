/**
 * CLI entry point for running backtests.
 *
 * Usage: npm run backtest [strategy] [granularity] --user=<id-or-email>
 * Examples:
 *   npm run backtest lead-lag M1 --user=mark@oosterveld.org
 *   npm run backtest session-divergence S5 --user=58bb271e...
 *
 * The --user flag is required and determines where reports are saved
 * (data/users/{id}/reports/).
 *
 * All lookback/hold parameters are defined in M1 units (1 candle = 1 minute)
 * and automatically scaled for the target granularity.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { findUser, getUserBacktestsDir } from "../core/users.js";
import { loadStrategy } from "../core/strategy-loader.js";
import { GRANULARITY_SECONDS, type Granularity } from "../core/types.js";
import { runBacktest, printResults } from "./engine.js";
import { SPREADS } from "../data/spreads.js";
import type { BacktestConfig } from "./types.js";

const strategyName = process.argv[2] || "lead-lag";
const granularity = (process.argv[3] || "M1") as Granularity;

/**
 * Scale a value defined in M1 candles to the target granularity.
 * E.g., 60 M1 candles (1 hour) → 720 S5 candles (still 1 hour).
 * Always returns at least 1.
 */
function scale(m1Candles: number): number {
  const m1Seconds = 60;
  const targetSeconds = GRANULARITY_SECONDS[granularity] ?? 60;
  return Math.max(1, Math.round(m1Candles * (m1Seconds / targetSeconds)));
}

// Optional flags: --spread-mult=2.0 --exec-delay=1 --entry-delay=5
const spreadMultiplier = parseFloat(
  process.argv.find((a) => a.startsWith("--spread-mult="))?.split("=")[1] ?? "1.0",
);
const executionDelay = parseInt(
  process.argv.find((a) => a.startsWith("--exec-delay="))?.split("=")[1] ?? "0",
  10,
);
const entryDelay = parseInt(
  process.argv.find((a) => a.startsWith("--entry-delay="))?.split("=")[1] ?? "0",
  10,
);
const timeVaryingSpread = process.argv.includes("--time-varying-spread");
const slippagePips = parseFloat(
  process.argv.find((a) => a.startsWith("--slippage="))?.split("=")[1] ?? "0",
);
const fromDate = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1];
const toDate = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1];
const rewardRatio = parseFloat(
  process.argv.find((a) => a.startsWith("--reward="))?.split("=")[1] ?? "0",
);
const pairsFlag = process.argv.find((a) => a.startsWith("--pairs="))?.split("=")[1] ?? "";
const initialBalance = parseFloat(
  process.argv.find((a) => a.startsWith("--balance="))?.split("=")[1] ?? "1000",
);
const unitsFlag = process.argv.find((a) => a.startsWith("--units="))?.split("=")[1];
const units = unitsFlag ? parseInt(unitsFlag, 10) : Math.round(initialBalance * 0.1);
const stopFracFlag = process.argv.find((a) => a.startsWith("--stop-frac="))?.split("=")[1];
const stopRangeFraction = stopFracFlag ? parseFloat(stopFracFlag) : undefined;
const accountCurrency = process.argv.find((a) => a.startsWith("--currency="))?.split("=")[1] ?? "USD";
const skipDaysFlag = process.argv.find((a) => a.startsWith("--skip-days="))?.split("=")[1];
const skipDays = skipDaysFlag ? skipDaysFlag.split(",").map(Number) : undefined;
const userFlag = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1];

// Resolve user and reports directory
if (!userFlag) {
  console.error("Error: --user=<id-or-email> is required.");
  console.error("Usage: npm run backtest <strategy> <granularity> --user=<id-or-email>");
  process.exit(1);
}
const user = findUser(userFlag);
if (!user) {
  console.error(`User not found: ${userFlag}`);
  console.error("Use a user ID or email address.");
  process.exit(1);
}
const backtestsDir = getUserBacktestsDir(user.id);
console.log(`User: ${user.email} (${user.role})`);

const backtestConfig: BacktestConfig = {
  granularity,
  initialBalance,
  spread: SPREADS,
  spreadMultiplier,
  executionDelay,
  timeVaryingSpread,
  slippagePips,
  fromDate,
  toDate,
  accountCurrency,
};

async function main() {
  const strategy = await loadStrategy(user!.id, strategyName, {
    units,
    spreads: SPREADS,
    entryDelay,
    // london-breakout specific CLI flags
    rewardRatio: rewardRatio || 0,
    instruments: pairsFlag
      ? pairsFlag.split(",")
      : undefined,
    trailActivateFraction: parseFloat(process.argv.find((a) => a.startsWith("--trail-activate="))?.split("=")[1] ?? "2.0"),
    trailDistanceFraction: parseFloat(process.argv.find((a) => a.startsWith("--trail-dist="))?.split("=")[1] ?? "1.0"),
    ...(stopRangeFraction !== undefined && { stopRangeFraction }),
    ...(skipDays !== undefined && { skipDays }),
  });

  const flags = [];
  if (spreadMultiplier !== 1.0) flags.push(`spread×${spreadMultiplier}`);
  if (executionDelay > 0) flags.push(`delay=${executionDelay} ticks`);
  if (entryDelay > 0) flags.push(`entry-delay=${entryDelay}min`);
  if (timeVaryingSpread) flags.push("time-varying-spread");
  if (slippagePips > 0) flags.push(`slippage=${slippagePips}pips`);
  if (fromDate) flags.push(`from=${fromDate}`);
  if (toDate) flags.push(`to=${toDate}`);
  const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  console.log(`Running ${strategyName} backtest on ${granularity} data (scale factor: ${scale(1)}x)${flagStr}...`);
  const result = await runBacktest(strategy, backtestConfig);
  printResults(result);

  if (!existsSync(backtestsDir)) {
    mkdirSync(backtestsDir, { recursive: true });
  }

  const strategyParams: Record<string, unknown> = {
    units,
    entryDelay,
    rewardRatio: rewardRatio || 0,
    instruments: pairsFlag ? pairsFlag.split(",") : undefined,
    trailActivateFraction: parseFloat(process.argv.find((a) => a.startsWith("--trail-activate="))?.split("=")[1] ?? "2.0"),
    trailDistanceFraction: parseFloat(process.argv.find((a) => a.startsWith("--trail-dist="))?.split("=")[1] ?? "1.0"),
    ...(stopRangeFraction !== undefined && { stopRangeFraction }),
    ...(skipDays !== undefined && { skipDays }),
  };
  // Strip undefined values
  for (const k of Object.keys(strategyParams)) {
    if (strategyParams[k] === undefined) delete strategyParams[k];
  }

  // Generic config overrides: --config.key=value (e.g., --config.stopAtrMult=3.0)
  for (const arg of process.argv) {
    const match = arg.match(/^--config\.(\w+)=(.+)$/);
    if (match) {
      const [, key, raw] = match;
      const num = parseFloat(raw);
      strategyParams[key] = isNaN(num) ? raw : num;
    }
  }

  const paramDescriptions: Record<string, string> = {
    units: "Position size in base currency units per trade",
    entryDelay: "Minutes to wait after breakout before entering (reduces false breakouts)",
    rewardRatio: "Risk:reward ratio for take-profit placement (0 = no TP, use session end)",
    instruments: "Specific currency pairs to trade (empty = all eligible pairs)",
    trailActivateFraction: "Trailing stop activates after price moves this fraction of the Asian range in profit",
    trailDistanceFraction: "Trailing stop distance as a fraction of the Asian range",
    stopRangeFraction: "Stop loss distance as a fraction of the Asian range (0.5 = midpoint, 1.0 = opposite side, >1.0 = beyond range)",
    skipDays: "Days of week to skip trading (0=Sun, 1=Mon, ..., 5=Fri, 6=Sat)",
    spreadMultiplier: "Multiply all spreads by this factor (1.0 = normal, 2.0 = stress test)",
    slippagePips: "Random adverse slippage in pips added to each fill",
    executionDelay: "Delay order execution by this many ticks (simulates latency)",
    timeVaryingSpread: "Use wider spreads at session open, tighter during overlap hours",
    initialBalance: "Starting account balance in USD",
  };

  // Build config hash from backtest + strategy params for unique filenames
  const configForHash = { backtestConfig, strategyParams };
  const configHash = createHash("sha256")
    .update(JSON.stringify(configForHash))
    .digest("hex")
    .slice(0, 8);
  const epochMs = Date.now();
  const baseName = `${strategyName}-${granularity}-${epochMs}-${configHash}`;

  const jsonPath = join(backtestsDir, `${baseName}.json`);
  writeFileSync(jsonPath, JSON.stringify({ strategyName, strategyConfig: strategyParams, backtestConfig, paramDescriptions, result }, null, 2));
  console.log(`Result: ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
