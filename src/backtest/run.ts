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
      return new SessionDivergenceStrategy({
        minDeviationPct: 0.03,
        reversionTarget: 0.7,
        minHold: scale(30),              // 30 minutes minimum hold
        maxHold: scale(240),             // 4 hours max hold
        takeProfitMultiple: 20,
        stopLossMultiple: 10,
        units: 10_000,
        spreads: SPREADS,
        cooldownPeriod: scale(480),      // 8 hour cooldown per instrument
      });
    default:
      console.error(`Unknown strategy: ${name}. Available: lead-lag, cross-drift, currency-momentum, session-divergence`);
      process.exit(1);
  }
}

const strategy = buildStrategy(strategyName);

const config: BacktestConfig = {
  granularity,
  initialBalance: 100_000,
  spread: SPREADS,
};

const REPORTS_DIR = join(import.meta.dirname, "../../reports");

async function main() {
  console.log(`Running ${strategyName} backtest on ${granularity} data (scale factor: ${scale(1)}x)...`);
  const result = await runBacktest(strategy, config);
  printResults(result);

  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const baseName = `${strategyName}-${granularity}-${ts}`;

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
