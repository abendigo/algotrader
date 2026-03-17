/**
 * CLI entry point for running backtests.
 *
 * Usage: npm run backtest [strategy] [granularity]
 * Examples:
 *   npm run backtest lead-lag M1
 *   npm run backtest session-divergence S5
 *
 * All lookback/hold parameters are defined in M1 units (1 candle = 1 minute)
 * and automatically scaled for the target granularity.
 *
 * Generates HTML and CSV reports in reports/
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Granularity } from "../core/types.js";
import type { Strategy } from "../core/strategy.js";
import { LeadLagStrategy } from "../strategies/lead-lag.js";
import { CrossDriftStrategy } from "../strategies/cross-drift.js";
import { CurrencyMomentumStrategy } from "../strategies/currency-momentum.js";
import { SessionDivergenceStrategy } from "../strategies/session-divergence.js";
import { LondonBreakoutStrategy } from "../strategies/london-breakout.js";
import { CrossMomentumStrategy } from "../strategies/cross-momentum.js";
import { RangeFadeStrategy } from "../strategies/range-fade.js";
import { CorrelationPairsStrategy } from "../strategies/correlation-pairs.js";
import { runBacktest, printResults } from "./engine.js";
import { exportHTML } from "./export-html.js";
import { exportCSV } from "./export-csv.js";
import { SPREADS } from "../data/spreads.js";
import type { BacktestConfig } from "./types.js";

const strategyName = process.argv[2] || "lead-lag";
const granularity = (process.argv[3] || "M1") as Granularity;

/** Seconds per candle for each granularity */
const GRANULARITY_SECONDS: Record<string, number> = {
  S5: 5, S10: 10, S15: 15, S30: 30,
  M1: 60, M2: 120, M4: 240, M5: 300,
  M10: 600, M15: 900, M30: 1800,
  H1: 3600, H2: 7200, H3: 10800, H4: 14400,
  H6: 21600, H8: 28800, H12: 43200,
  D: 86400, W: 604800,
};

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

function buildStrategy(name: string): Strategy {
  switch (name) {
    case "lead-lag":
      return new LeadLagStrategy({
        entryZ: 2.0,
        exitZ: 0.5,
        lookback: scale(60),       // 1 hour
        units: 10_000,
      });
    case "cross-drift":
      return new CrossDriftStrategy({
        driftLookback: scale(120),       // 2 hours
        driftThreshold: 0.001,
        deviationLookback: scale(30),    // 30 minutes
        entryZ: 1.0,
        maxHold: scale(60),              // 1 hour
        takeProfitMultiple: 3.0,
        stopLossMultiple: 2.0,
        units: 10_000,
        spreads: SPREADS,
      });
    case "currency-momentum":
      return new CurrencyMomentumStrategy({
        momentumLookback: scale(60),     // 1 hour
        minSpread: 0.05,
        maxHold: scale(120),             // 2 hours
        takeProfitMultiple: 4.0,
        stopLossMultiple: 2.0,
        units: 10_000,
        spreads: SPREADS,
      });
    case "session-divergence":
      // Config values are in minutes (time-based, not candle-based)
      return new SessionDivergenceStrategy({
        minDeviationPct: 0.015,
        reversionTarget: 0.7,
        minHold: 30,                     // 30 minutes minimum hold
        maxHold: 240,                    // 4 hours max hold
        takeProfitMultiple: 20,
        stopLossMultiple: 4,             // tight stop: 4x spread
        trailBreakevenAt: 2,             // activate trailing at 2x spread profit
        trailFraction: 0.5,             // keep at least 50% of peak profit
        units: 10_000,
        spreads: SPREADS,
        cooldownPeriod: 480,             // 8 hour cooldown per instrument
        entryDelay,                      // minutes after session open to wait (0 = immediate)
      });
    case "london-breakout": {
      const lbConfig: Partial<import("../strategies/london-breakout.js").LondonBreakoutConfig> = {
        minBreakoutFraction: 0.1,
        rewardRatio: rewardRatio || 0,
        maxRangePct: 0.005,
        minRangePct: 0.0005,
        units: 100,
        riskPerTrade: 0,               // fixed sizing
        stopRangeFraction: 1.0,         // stop at opposite side of Asian range
        trailActivateFraction: 0.5,    // activate trail once PnL > 50% of Asian range
        trailDistanceFraction: 0.3,    // trail 30% of range behind peak
        instruments: pairsFlag
          ? pairsFlag.split(",")
          : ["EUR_USD", "GBP_USD", "USD_CAD", "USD_CHF", "AUD_USD", "NZD_USD"],
        skipDays: [5],
      };
      return new LondonBreakoutStrategy(lbConfig);
    }
    case "cross-momentum":
      return new CrossMomentumStrategy({
        deviationLookback: 60,
        momentumWindow: 30,
        momentumThreshold: 0.005,
        momentumExitFraction: 0.3,
        maxHold: 360,
        stopLossPct: 0.003,
        units: 10_000,
        maxSpread: 0.0005,
        spreads: SPREADS,
        maxPositions: 3,
      });
    case "range-fade":
      return new RangeFadeStrategy({
        breakoutConfirmFraction: 0.1,
        takeProfitRangeFraction: 0.8,
        stopBeyondExtremeFraction: 0.3,
        maxRangePct: 0.004,
        minRangePct: 0.0003,
        units: 10_000,
      });
    case "correlation-pairs":
      return new CorrelationPairsStrategy({
        instrumentA: "AUD_USD",
        instrumentB: "NZD_USD",
        lookback: 1440,
        entryZ: 2.0,
        exitZ: 0.5,
        maxHold: 2880,
        stopZ: 3.5,
        units: 10_000,
        warmupPeriod: 720,
      });
    default:
      console.error(`Unknown strategy: ${name}. Available: lead-lag, cross-drift, currency-momentum, session-divergence, london-breakout, cross-momentum, range-fade, correlation-pairs`);
      process.exit(1);
  }
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

const strategy = buildStrategy(strategyName);

const config: BacktestConfig = {
  granularity,
  initialBalance: 1_000,
  spread: SPREADS,
  spreadMultiplier,
  executionDelay,
  timeVaryingSpread,
  slippagePips,
  fromDate,
  toDate,
};

const REPORTS_DIR = join(import.meta.dirname, "../../reports");

async function main() {
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
  const result = await runBacktest(strategy, config);
  printResults(result);

  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const baseName = `${strategyName}-${granularity}-${ts}`;

  const jsonPath = join(REPORTS_DIR, `${baseName}.json`);
  writeFileSync(jsonPath, JSON.stringify({ strategyName, result }, null, 2));
  console.log(`Result data: ${jsonPath}`);

  const htmlPath = join(REPORTS_DIR, `${baseName}.html`);
  writeFileSync(htmlPath, exportHTML(result, strategyName));
  console.log(`HTML report: ${htmlPath}`);

  const csvPath = join(REPORTS_DIR, `${baseName}.csv`);
  writeFileSync(csvPath, exportCSV(result));
  console.log(`CSV report:  ${csvPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
