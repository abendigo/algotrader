/**
 * Cross-Rate Drift Strategy
 *
 * Combines structural drift detection with lead-lag entry timing.
 *
 * Observation: some cross pairs have persistent directional drift over
 * multi-hour windows (e.g., AUD/NZD tends to trend for hours before
 * reverting). This strategy:
 *
 * 1. Computes the drift direction of each cross over a slow lookback
 *    (e.g., 120 candles) using linear regression slope.
 * 2. Uses the lead-lag deviation (actual vs implied from USD legs) as
 *    an entry signal — but only enters in the drift direction.
 *    When the cross is drifting UP and the lead-lag deviation shows
 *    the cross is temporarily BELOW implied → buy (favorable entry
 *    into an uptrend).
 * 3. Exits when either:
 *    - The position has been held for maxHold candles (time stop)
 *    - PnL hits the profit target (take profit)
 *    - PnL hits the stop loss (risk management)
 *    - Drift direction reverses (trend ended)
 *
 * Key difference from lead-lag: we trade WITH the drift, not against
 * the deviation. The deviation is just the entry timing mechanism.
 */

import type { Strategy, StrategyContext, StrategyStateSnapshot } from "#core/strategy.js";
import type { Instrument, Tick } from "#core/types.js";
import type { SignalSnapshot } from "#backtest/types.js";
import { BacktestBroker } from "#backtest/broker.js";
import {
  CROSSES,
  parsePair,
  findTriangle,
  type Currency,
} from "#data/instruments.js";

export interface CrossDriftConfig {
  /** Slow lookback for drift detection via linear regression (default: 120) */
  driftLookback: number;
  /** Minimum |slope| to consider a drift tradeable (default: 0.001) */
  driftThreshold: number;
  /** Fast lookback for deviation z-score (default: 30) */
  deviationLookback: number;
  /** Z-score threshold for entry timing — enter when deviation is favorable (default: 1.0) */
  entryZ: number;
  /** Max candles to hold a position (default: 60) */
  maxHold: number;
  /** Take profit as multiple of entry spread cost (default: 3.0) */
  takeProfitMultiple: number;
  /** Stop loss as multiple of entry spread cost (default: 2.0) */
  stopLossMultiple: number;
  /** Units per trade (default: 10000) */
  units: number;
  /** Which crosses to trade (default: all 21) */
  crosses?: readonly string[];
  /** Per-instrument spread for TP/SL calculation */
  spreads?: Record<string, number>;
}

export const strategyMeta = {
  name: "Cross-Rate Drift",
  description: "Combines structural drift detection with lead-lag entry timing. Detects persistent directional drift, then uses the lead-lag deviation as a favorable entry point.",
  configFields: {
    common: {
      entryZ: { label: "Entry z-score", type: "number" as const, default: 1.0, min: 0, step: 0.1 },
      driftLookback: { label: "Drift lookback (candles)", type: "number" as const, default: 120, min: 1 },
      driftThreshold: { label: "Drift threshold", type: "number" as const, default: 0.001, min: 0, step: 0.0005 },
      maxHold: { label: "Max hold (candles)", type: "number" as const, default: 60, min: 1 },
    },
    backtest: {},
    live: {
      units: { label: "Units", type: "number" as const, default: 10000, min: 1 },
    },
  },
};

const DEFAULT_CONFIG: CrossDriftConfig = {
  driftLookback: 120,
  driftThreshold: 0.001,
  deviationLookback: 30,
  entryZ: 1.0,
  maxHold: 60,
  takeProfitMultiple: 3.0,
  stopLossMultiple: 2.0,
  units: 10_000,
};

interface CrossState {
  cross: string;
  legA: string;
  legB: string;
  baseCcy: Currency;
  quoteCcy: Currency;
  priceHistory: number[];
  deviationHistory: number[];
}

interface OpenPosition {
  cross: string;
  side: "buy" | "sell";
  entryPrice: number;
  entryTick: number; // tick counter at entry
  takeProfit: number;
  stopLoss: number;
  driftDirection: 1 | -1;
}

function toUsdRate(instrument: string, price: number): number {
  const [base] = parsePair(instrument);
  return base === "USD" ? price : 1 / price;
}

export class CrossDriftStrategy implements Strategy {
  readonly name = "cross-drift";
  readonly hedging = "forbidden" as const;

  private config: CrossDriftConfig;
  private prices = new Map<Instrument, number>();
  private crossStates: CrossState[] = [];
  private openPositions = new Map<string, OpenPosition>();
  private tickCount = 0;

  constructor(config?: Partial<CrossDriftConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(_ctx: StrategyContext): Promise<void> {
    const crosses = this.config.crosses ?? CROSSES;

    for (const cross of crosses) {
      const triangle = findTriangle(cross);
      if (!triangle) continue;

      const [baseCcy, quoteCcy] = parsePair(cross);
      this.crossStates.push({
        cross,
        legA: triangle.legA,
        legB: triangle.legB,
        baseCcy: baseCcy as Currency,
        quoteCcy: quoteCcy as Currency,
        priceHistory: [],
        deviationHistory: [],
      });
    }
  }

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    this.prices.set(tick.instrument, (tick.bid + tick.ask) / 2);
    this.tickCount++;

    const state = this.crossStates.find((s) => s.cross === tick.instrument);
    if (!state) return;

    const legAPrice = this.prices.get(state.legA);
    const legBPrice = this.prices.get(state.legB);
    const crossPrice = this.prices.get(state.cross);
    if (!legAPrice || !legBPrice || !crossPrice) return;

    // Track cross price history for drift detection
    state.priceHistory.push(crossPrice);
    if (state.priceHistory.length > this.config.driftLookback) {
      state.priceHistory.shift();
    }

    // Compute implied rate and deviation
    const rateBase = toUsdRate(state.legA, legAPrice);
    const rateQuote = toUsdRate(state.legB, legBPrice);
    const implied = rateQuote / rateBase;
    const deviation = ((crossPrice - implied) / implied) * 100;

    state.deviationHistory.push(deviation);
    if (state.deviationHistory.length > this.config.deviationLookback) {
      state.deviationHistory.shift();
    }

    // Check exit conditions for open position
    const pos = this.openPositions.get(state.cross);
    if (pos) {
      const ticksHeld = this.tickCount - pos.entryTick;
      const currentPnL =
        pos.side === "buy"
          ? crossPrice - pos.entryPrice
          : pos.entryPrice - crossPrice;

      // Compute current drift to check for reversal
      const currentDrift =
        state.priceHistory.length >= this.config.driftLookback
          ? linearRegressionSlope(state.priceHistory)
          : 0;
      const driftReversed =
        (pos.driftDirection === 1 && currentDrift < -this.config.driftThreshold) ||
        (pos.driftDirection === -1 && currentDrift > this.config.driftThreshold);

      const shouldExit =
        ticksHeld >= this.config.maxHold ||
        currentPnL >= pos.takeProfit ||
        currentPnL <= -pos.stopLoss ||
        driftReversed;

      if (shouldExit) {
        const exitReason =
          currentPnL >= pos.takeProfit ? "take-profit" :
          currentPnL <= -pos.stopLoss ? "stop-loss" :
          driftReversed ? "drift-reversal" : "max-hold";

        if (ctx.broker instanceof BacktestBroker) {
          ctx.broker.setExitSignal({
            zScore: this.currentZ(state),
            deviation,
            deviationMean: mean(state.deviationHistory),
            deviationStd: std(state.deviationHistory),
            impliedRate: implied,
            actualRate: crossPrice,
            legA: state.legA,
            legAPrice: legAPrice!,
            legB: state.legB,
            legBPrice: legBPrice!,
          });
        }
        await ctx.broker.closePosition(state.cross);
        this.openPositions.delete(state.cross);
      }
      return; // don't enter a new position while we have one
    }

    // Need full windows before trading
    if (state.priceHistory.length < this.config.driftLookback) return;
    if (state.deviationHistory.length < this.config.deviationLookback) return;

    // Detect drift direction
    const slope = linearRegressionSlope(state.priceHistory);
    if (Math.abs(slope) < this.config.driftThreshold) return;
    const driftDirection: 1 | -1 = slope > 0 ? 1 : -1;

    // Compute deviation z-score
    const z = this.currentZ(state);

    // Entry logic: drift is UP and cross is temporarily BELOW implied (z < -entryZ) → buy
    //              drift is DOWN and cross is temporarily ABOVE implied (z > entryZ) → sell
    const favorableEntry =
      (driftDirection === 1 && z < -this.config.entryZ) ||
      (driftDirection === -1 && z > this.config.entryZ);

    if (!favorableEntry) return;

    const side = driftDirection === 1 ? "buy" : "sell";

    // Calculate TP/SL based on spread cost
    const spreadCost = this.config.spreads?.[state.cross] ?? 0.0002;
    const takeProfit = spreadCost * this.config.takeProfitMultiple;
    const stopLoss = spreadCost * this.config.stopLossMultiple;

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setEntrySignal({
        zScore: z,
        deviation,
        deviationMean: mean(state.deviationHistory),
        deviationStd: std(state.deviationHistory),
        impliedRate: implied,
        actualRate: crossPrice,
        legA: state.legA,
        legAPrice: legAPrice!,
        legB: state.legB,
        legBPrice: legBPrice!,
      });
    }

    await ctx.broker.submitOrder({
      instrument: state.cross,
      side,
      type: "market",
      units: this.config.units,
    });

    this.openPositions.set(state.cross, {
      cross: state.cross,
      side,
      entryPrice: crossPrice,
      entryTick: this.tickCount,
      takeProfit,
      stopLoss,
      driftDirection,
    });
  }


  getState(): StrategyStateSnapshot {
    return {
      phase: "Running",
      indicators: [],
      positions: [],
    };
  }
  async dispose(): Promise<void> {
    this.crossStates = [];
    this.prices.clear();
    this.openPositions.clear();
  }

  private currentZ(state: CrossState): number {
    const arr = state.deviationHistory;
    if (arr.length === 0) return 0;
    const m = mean(arr);
    const s = std(arr);
    if (s === 0) return 0;
    return (arr[arr.length - 1] - m) / s;
  }
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Linear regression slope over an array of prices.
 * Normalized by mean price so the slope is comparable across instruments.
 * Positive = uptrend, negative = downtrend.
 */
function linearRegressionSlope(prices: number[]): number {
  const n = prices.length;
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const meanPrice = sumY / n;

  // Normalize: slope per candle as fraction of mean price
  return (slope / meanPrice) * 1000; // scale to make threshold intuitive
}
