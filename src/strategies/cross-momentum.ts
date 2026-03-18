/**
 * Cross-Pair Momentum Strategy
 *
 * The opposite of the lead-lag mean-reversion approach: when a cross
 * pair deviates from its USD-implied rate, bet that the deviation
 * CONTINUES rather than reverts. This works because large deviations
 * at longer timeframes often represent real information (central bank
 * flows, macro shifts) rather than noise.
 *
 * Signal:
 *   1. Compute rolling deviation of each cross from its USD-implied rate
 *   2. Compute rate-of-change of the deviation over a momentum window
 *   3. When deviation is accelerating (ROC > threshold), enter WITH the trend
 *   4. Hold until momentum fades (ROC reverses) or max hold reached
 *
 * Key difference from lead-lag: we trade WITH the deviation, not against it.
 * Key difference from cross-drift: we use deviation momentum, not price momentum.
 *
 * Trades only tight-spread crosses. Holds for hours.
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

export interface CrossMomentumConfig {
  /** Rolling window for deviation calculation (minutes, default: 60) */
  deviationLookback: number;
  /** Window for deviation rate-of-change / momentum (minutes, default: 30) */
  momentumWindow: number;
  /** Minimum |momentum| to enter (default: 0.005) */
  momentumThreshold: number;
  /** Exit when momentum drops below this fraction of entry momentum (default: 0.3) */
  momentumExitFraction: number;
  /** Max hold time in minutes (default: 360 = 6 hours) */
  maxHold: number;
  /** Stop loss as fraction of price (default: 0.003 = 0.3%) */
  stopLossPct: number;
  /** Units per trade (default: 10000) */
  units: number;
  /** Only trade crosses with spread below this value (default: 0.0005) */
  maxSpread: number;
  /** Per-instrument spreads for filtering */
  spreads?: Record<string, number>;
  /** Max simultaneous positions (default: 3) */
  maxPositions: number;
}

export const strategyMeta = {
  name: "Cross-Pair Momentum",
  description: "When a cross pair deviates from its USD-implied rate and the deviation is accelerating, bet that it continues. Targets information-driven moves.",
  configFields: {
    common: {
      momentumWindow: { label: "Momentum window (candles)", type: "number" as const, default: 30, min: 1 },
      momentumThreshold: { label: "Momentum threshold", type: "number" as const, default: 0.005, min: 0, step: 0.001 },
      maxHold: { label: "Max hold (candles)", type: "number" as const, default: 360, min: 1 },
    },
    backtest: {},
    live: {
      units: { label: "Units", type: "number" as const, default: 10000, min: 1 },
    },
  },
};

const DEFAULT_CONFIG: CrossMomentumConfig = {
  deviationLookback: 60,
  momentumWindow: 30,
  momentumThreshold: 0.005,
  momentumExitFraction: 0.3,
  maxHold: 360,
  stopLossPct: 0.003,
  units: 10_000,
  maxSpread: 0.0005,
  maxPositions: 3,
};

interface CrossState {
  cross: string;
  legA: string;
  legB: string;
  baseCcy: Currency;
  quoteCcy: Currency;
  deviationHistory: { timestamp: number; deviation: number }[];
}

interface OpenPosition {
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  entryTimestamp: number;
  entryMomentum: number;
  stopLoss: number;
}

function toUsdRate(instrument: string, price: number): number {
  const [base] = parsePair(instrument);
  return base === "USD" ? price : 1 / price;
}

export class CrossMomentumStrategy implements Strategy {
  readonly name = "cross-momentum";
  readonly hedging = "forbidden" as const;

  private config: CrossMomentumConfig;
  private prices = new Map<Instrument, number>();
  private crossStates: CrossState[] = [];
  private positions = new Map<string, OpenPosition>();
  private currentTimestamp = 0;

  constructor(config?: Partial<CrossMomentumConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(_ctx: StrategyContext): Promise<void> {
    const crosses = CROSSES.filter((cross) => {
      const spread = this.config.spreads?.[cross] ?? 0.001;
      return spread <= this.config.maxSpread;
    });

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
        deviationHistory: [],
      });
    }
  }

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    this.prices.set(tick.instrument, (tick.bid + tick.ask) / 2);
    this.currentTimestamp = tick.timestamp;

    const state = this.crossStates.find((s) => s.cross === tick.instrument);
    if (!state) return;

    const legAPrice = this.prices.get(state.legA);
    const legBPrice = this.prices.get(state.legB);
    const crossPrice = this.prices.get(state.cross);
    if (!legAPrice || !legBPrice || !crossPrice) return;

    // Compute deviation
    const rateBase = toUsdRate(state.legA, legAPrice);
    const rateQuote = toUsdRate(state.legB, legBPrice);
    const implied = rateQuote / rateBase;
    const deviation = ((crossPrice - implied) / implied) * 100;

    // Track deviation history with timestamps
    state.deviationHistory.push({ timestamp: tick.timestamp, deviation });

    // Prune old entries (keep lookback + momentum window)
    const maxAge = (this.config.deviationLookback + this.config.momentumWindow) * 60_000;
    const cutoff = tick.timestamp - maxAge;
    while (state.deviationHistory.length > 0 && state.deviationHistory[0].timestamp < cutoff) {
      state.deviationHistory.shift();
    }

    // Need enough history
    const momentumMs = this.config.momentumWindow * 60_000;
    const oldestNeeded = tick.timestamp - momentumMs;
    const oldEntry = state.deviationHistory.find((e) => e.timestamp >= oldestNeeded);
    if (!oldEntry) return;

    // Momentum = rate of change of deviation
    const momentum = deviation - oldEntry.deviation;

    // Check exits for open position
    const pos = this.positions.get(state.cross);
    if (pos) {
      await this.checkExit(ctx, tick, pos, crossPrice, momentum);
      return;
    }

    // Entry: momentum exceeds threshold, and we have capacity
    if (this.positions.size >= this.config.maxPositions) return;
    if (Math.abs(momentum) < this.config.momentumThreshold) return;

    // Skip weekends
    const dayOfWeek = new Date(tick.timestamp).getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return;

    // Positive momentum = deviation growing (cross moving away from implied upward) → buy
    // Negative momentum = deviation shrinking/going negative → sell
    const side: "buy" | "sell" = momentum > 0 ? "buy" : "sell";
    const stopLoss = crossPrice * this.config.stopLossPct;

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setEntrySignal({
        zScore: momentum / this.config.momentumThreshold,
        deviation,
        deviationMean: oldEntry.deviation,
        deviationStd: 0,
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

    this.positions.set(state.cross, {
      instrument: state.cross,
      side,
      entryPrice: crossPrice,
      entryTimestamp: tick.timestamp,
      entryMomentum: momentum,
      stopLoss,
    });
  }

  private async checkExit(
    ctx: StrategyContext,
    tick: Tick,
    pos: OpenPosition,
    currentPrice: number,
    currentMomentum: number,
  ): Promise<void> {
    const elapsed = tick.timestamp - pos.entryTimestamp;
    const maxHoldMs = this.config.maxHold * 60_000;

    const pnl =
      pos.side === "buy"
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;

    // Stop loss (absolute price move)
    const stoppedOut = pnl <= -pos.stopLoss;

    // Max hold
    const maxHoldReached = elapsed >= maxHoldMs;

    // Momentum faded or reversed
    const momentumFaded =
      pos.side === "buy"
        ? currentMomentum < pos.entryMomentum * this.config.momentumExitFraction
        : currentMomentum > pos.entryMomentum * this.config.momentumExitFraction;

    if (!stoppedOut && !maxHoldReached && !momentumFaded) return;

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setExitSignal({
        zScore: currentMomentum / this.config.momentumThreshold,
        deviation: 0,
        deviationMean: 0,
        deviationStd: 0,
        impliedRate: 0,
        actualRate: currentPrice,
        legA: stoppedOut ? "stop-loss" : momentumFaded ? "momentum-fade" : "max-hold",
        legAPrice: pnl,
        legB: `entry-mom=${pos.entryMomentum.toFixed(4)}`,
        legBPrice: currentMomentum,
      });
    }

    await ctx.broker.closePosition(tick.instrument);
    this.positions.delete(tick.instrument);
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
    this.positions.clear();
  }
}
