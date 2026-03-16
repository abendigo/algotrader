/**
 * Lead-lag analysis for cross-currency triangles.
 *
 * For each cross pair (e.g., AUD_CAD), computes:
 * 1. The implied rate from the two USD legs (AUD_USD, USD_CAD)
 * 2. The deviation between actual and implied over time
 * 3. Autocorrelation of the deviation (does it mean-revert?)
 * 4. Cross-correlation at various lags (does the cross lag the implied?)
 *
 * Usage: npx tsx src/data/analyze.ts [granularity]
 * Example: npx tsx src/data/analyze.ts M1
 */

import type { Candle } from "../core/types.js";
import { CROSSES, parsePair, findTriangle } from "./instruments.js";
import type { Currency } from "./instruments.js";
import { loadCandles } from "./loader.js";

/**
 * Convert a pair's close price to "units of currency per 1 USD".
 * - If pair is XXX_USD (e.g., EUR_USD = 1.10), then rate = 1/1.10 (USD per EUR → invert)
 *   Actually: EUR_USD = 1.10 means 1 EUR = 1.10 USD, so 1 USD = 1/1.10 EUR = 0.909 EUR
 *   We want: how many units of XXX per 1 USD → 1/price
 * - If pair is USD_XXX (e.g., USD_JPY = 150), then rate = 150 (already units of XXX per USD)
 */
function toUsdRate(
  instrument: string,
  price: number,
  currency: Currency,
): number {
  const [base] = parsePair(instrument);
  if (base === "USD") {
    // USD_XXX: price is already units-of-XXX per 1 USD
    return price;
  } else {
    // XXX_USD: price is units-of-USD per 1 XXX → invert
    return 1 / price;
  }
}

/**
 * Compute the implied cross rate from two USD legs.
 * Cross = BASE_QUOTE
 * Implied = (USD per QUOTE) / (USD per BASE)
 * Wait — let me think about this more carefully.
 *
 * BASE_QUOTE means: 1 BASE = X QUOTE.
 * If we know:
 *   - How many BASE per 1 USD (call it rateBase)
 *   - How many QUOTE per 1 USD (call it rateQuote)
 * Then: 1 USD = rateBase BASE = rateQuote QUOTE
 *   So: 1 BASE = (rateQuote / rateBase) QUOTE
 *   Implied cross rate = rateQuote / rateBase
 */
function computeImpliedRate(
  legACandles: Candle[],
  legBCandles: Candle[],
  cross: string,
  legA: string,
  legB: string,
): { timestamps: number[]; implied: number[]; actual: number[] } | null {
  const [baseCcy, quoteCcy] = parsePair(cross);
  const crossCandles = loadCandles(granularity, cross);

  // Build timestamp-indexed maps
  const legAMap = new Map(legACandles.map((c) => [c.timestamp, c.close]));
  const legBMap = new Map(legBCandles.map((c) => [c.timestamp, c.close]));
  const crossMap = new Map(crossCandles.map((c) => [c.timestamp, c.close]));

  // Find overlapping timestamps
  const timestamps = crossCandles
    .map((c) => c.timestamp)
    .filter((t) => legAMap.has(t) && legBMap.has(t));

  if (timestamps.length < 100) return null;

  const implied: number[] = [];
  const actual: number[] = [];

  for (const t of timestamps) {
    const legAPrice = legAMap.get(t)!;
    const legBPrice = legBMap.get(t)!;

    const rateBase = toUsdRate(legA, legAPrice, baseCcy);
    const rateQuote = toUsdRate(legB, legBPrice, quoteCcy);

    implied.push(rateQuote / rateBase);
    actual.push(crossMap.get(t)!);
  }

  return { timestamps, implied, actual };
}

/** Compute percentage deviation: (actual - implied) / implied * 100 */
function computeDeviation(actual: number[], implied: number[]): number[] {
  return actual.map((a, i) => ((a - implied[i]) / implied[i]) * 100);
}

/** Compute mean and standard deviation */
function stats(arr: number[]): { mean: number; std: number } {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

/** Compute autocorrelation at a given lag */
function autocorrelation(arr: number[], lag: number): number {
  const { mean, std } = stats(arr);
  if (std === 0) return 0;
  const n = arr.length;
  let sum = 0;
  for (let i = 0; i < n - lag; i++) {
    sum += (arr[i] - mean) * (arr[i + lag] - mean);
  }
  return sum / ((n - lag) * std * std);
}

/**
 * Compute cross-correlation: does the deviation at time t
 * predict the deviation change at time t+lag?
 * Positive correlation means the deviation persists (momentum).
 * Negative correlation means it reverts (mean-reversion).
 */
function deviationPredictability(deviation: number[], lag: number): number {
  const changes: number[] = [];
  const levels: number[] = [];
  for (let i = 0; i < deviation.length - lag; i++) {
    levels.push(deviation[i]);
    changes.push(deviation[i + lag] - deviation[i]);
  }
  return correlation(levels, changes);
}

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const aStats = stats(a);
  const bStats = stats(b);
  if (aStats.std === 0 || bStats.std === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (a[i] - aStats.mean) * (b[i] - bStats.mean);
  }
  return sum / (n * aStats.std * bStats.std);
}

// --- Main ---

let granularity = process.argv[2] || "M1";

function main() {
  console.log(`\nLead-Lag Analysis (${granularity} candles)\n${"=".repeat(50)}\n`);

  const results: Array<{
    cross: string;
    legA: string;
    legB: string;
    dataPoints: number;
    deviationMean: number;
    deviationStd: number;
    autocorr1: number;
    autocorr5: number;
    predictability1: number;
    predictability5: number;
    predictability10: number;
  }> = [];

  for (const cross of CROSSES) {
    const triangle = findTriangle(cross);
    if (!triangle) continue;

    try {
      const legACandles = loadCandles(granularity, triangle.legA);
      const legBCandles = loadCandles(granularity, triangle.legB);

      const data = computeImpliedRate(
        legACandles,
        legBCandles,
        cross,
        triangle.legA,
        triangle.legB,
      );

      if (!data) {
        console.log(`${cross}: insufficient overlapping data, skipping`);
        continue;
      }

      const deviation = computeDeviation(data.actual, data.implied);
      const devStats = stats(deviation);

      const result = {
        cross,
        legA: triangle.legA,
        legB: triangle.legB,
        dataPoints: data.timestamps.length,
        deviationMean: devStats.mean,
        deviationStd: devStats.std,
        autocorr1: autocorrelation(deviation, 1),
        autocorr5: autocorrelation(deviation, 5),
        predictability1: deviationPredictability(deviation, 1),
        predictability5: deviationPredictability(deviation, 5),
        predictability10: deviationPredictability(deviation, 10),
      };

      results.push(result);
    } catch (err) {
      console.log(`${cross}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Sort by deviation std (largest mispricings first)
  results.sort((a, b) => b.deviationStd - a.deviationStd);

  console.log("Cross       | Legs              | Points | Dev Mean% | Dev Std% | AC(1)  | AC(5)  | Pred(1) | Pred(5) | Pred(10)");
  console.log("------------|-------------------|--------|-----------|----------|--------|--------|---------|---------|--------");

  for (const r of results) {
    console.log(
      `${r.cross.padEnd(11)} | ${(r.legA + "+" + r.legB).padEnd(17)} | ${String(r.dataPoints).padStart(6)} | ${r.deviationMean.toFixed(4).padStart(9)} | ${r.deviationStd.toFixed(4).padStart(8)} | ${r.autocorr1.toFixed(3).padStart(6)} | ${r.autocorr5.toFixed(3).padStart(6)} | ${r.predictability1.toFixed(3).padStart(7)} | ${r.predictability5.toFixed(3).padStart(7)} | ${r.predictability10.toFixed(3).padStart(8)}`,
    );
  }

  console.log(`\n--- Interpretation ---`);
  console.log(`Dev Std%   : How much the actual cross deviates from implied (bigger = more opportunity)`);
  console.log(`AC(n)      : Autocorrelation at lag n. High = deviation persists. Low/negative = fast reversion.`);
  console.log(`Pred(n)    : Correlation of deviation level with subsequent change at lag n.`);
  console.log(`             Negative = mean-reverting (good for this strategy). Closer to -1 = stronger signal.`);
  console.log(`             Look for crosses with high Dev Std AND negative Pred values.\n`);
}

main();
