/**
 * CLI entry point for running backtests.
 *
 * Usage: npm run backtest [strategy] [granularity]
 * Examples:
 *   npm run backtest lead-lag M1
 *   npm run backtest cross-drift M1
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
import { runBacktest, printResults } from "./engine.js";
import { exportHTML } from "./export-html.js";
import { exportCSV } from "./export-csv.js";
import { SPREADS } from "../data/spreads.js";
import type { BacktestConfig } from "./types.js";

const strategyName = process.argv[2] || "lead-lag";
const granularity = (process.argv[3] || "M1") as Granularity;

function buildStrategy(name: string): Strategy {
  switch (name) {
    case "lead-lag":
      return new LeadLagStrategy({
        entryZ: 2.0,
        exitZ: 0.5,
        lookback: 60,
        units: 10_000,
      });
    case "cross-drift":
      return new CrossDriftStrategy({
        driftLookback: 120,
        driftThreshold: 0.001,
        deviationLookback: 30,
        entryZ: 1.0,
        maxHold: 60,
        takeProfitMultiple: 3.0,
        stopLossMultiple: 2.0,
        units: 10_000,
        spreads: SPREADS,
      });
    case "currency-momentum":
      return new CurrencyMomentumStrategy({
        momentumLookback: 60,
        minSpread: 0.05,
        maxHold: 120,
        takeProfitMultiple: 4.0,
        stopLossMultiple: 2.0,
        units: 10_000,
        spreads: SPREADS,
      });
    default:
      console.error(`Unknown strategy: ${name}. Available: lead-lag, cross-drift, currency-momentum`);
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
  console.log(`Running ${strategyName} backtest on ${granularity} data...`);
  const result = await runBacktest(strategy, config);
  printResults(result);

  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const baseName = `${strategyName}-${ts}`;

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
