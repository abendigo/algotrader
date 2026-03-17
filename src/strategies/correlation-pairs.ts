/**
 * Correlation Pairs Trading Strategy
 *
 * AUD_USD and NZD_USD are highly correlated (~95%). When their spread
 * (ratio) diverges beyond historical norms, bet on convergence.
 *
 * Signal:
 *   1. Compute the ratio: AUD_USD / NZD_USD (the "spread")
 *   2. Compute rolling mean and std of this ratio
 *   3. When z-score of spread exceeds threshold → enter:
 *      - Z > entry: short AUD_USD, long NZD_USD (spread too wide)
 *      - Z < -entry: long AUD_USD, short NZD_USD (spread too narrow)
 *   4. Exit when z-score reverts past exit threshold
 *
 * Can be configured for any pair of correlated instruments.
 * Holds for hours to days. Market-neutral (hedged).
 */

import type { Strategy, StrategyContext } from "../core/strategy.js";
import type { Instrument, Tick } from "../core/types.js";
import type { SignalSnapshot } from "../backtest/types.js";
import { BacktestBroker } from "../backtest/broker.js";

export interface CorrelationPairsConfig {
  /** First instrument (default: AUD_USD) */
  instrumentA: string;
  /** Second instrument (default: NZD_USD) */
  instrumentB: string;
  /** Rolling window for mean/std of the spread ratio (minutes, default: 1440 = 1 day) */
  lookback: number;
  /** Z-score threshold to enter (default: 2.0) */
  entryZ: number;
  /** Z-score threshold to exit (default: 0.5) */
  exitZ: number;
  /** Maximum hold time in minutes (default: 2880 = 2 days) */
  maxHold: number;
  /** Stop loss: exit if z-score goes further against us by this amount (default: 3.5) */
  stopZ: number;
  /** Units per trade per leg (default: 10000) */
  units: number;
  /** Minimum data points before trading (default: 720 = 12 hours on M1) */
  warmupPeriod: number;
}

const DEFAULT_CONFIG: CorrelationPairsConfig = {
  instrumentA: "AUD_USD",
  instrumentB: "NZD_USD",
  lookback: 1440,
  entryZ: 2.0,
  exitZ: 0.5,
  maxHold: 2880,
  stopZ: 3.5,
  units: 10_000,
  warmupPeriod: 720,
};

interface OpenPairPosition {
  sideA: "buy" | "sell";
  sideB: "buy" | "sell";
  entryRatio: number;
  entryZ: number;
  entryTimestamp: number;
  entryPriceA: number;
  entryPriceB: number;
}

export class CorrelationPairsStrategy implements Strategy {
  readonly name = "correlation-pairs";

  private config: CorrelationPairsConfig;
  private prices = new Map<Instrument, number>();
  private ratioHistory: { timestamp: number; ratio: number }[] = [];
  private position: OpenPairPosition | null = null;
  private currentTimestamp = 0;
  private lastRatioTimestamp = 0;

  constructor(config?: Partial<CorrelationPairsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(_ctx: StrategyContext): Promise<void> {}

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    if (tick.instrument !== this.config.instrumentA && tick.instrument !== this.config.instrumentB) {
      return;
    }

    this.prices.set(tick.instrument, (tick.bid + tick.ask) / 2);
    this.currentTimestamp = tick.timestamp;

    const priceA = this.prices.get(this.config.instrumentA);
    const priceB = this.prices.get(this.config.instrumentB);
    if (!priceA || !priceB) return;

    // Only update ratio once per unique timestamp
    if (tick.timestamp === this.lastRatioTimestamp) return;
    this.lastRatioTimestamp = tick.timestamp;

    const ratio = priceA / priceB;

    // Track ratio history
    this.ratioHistory.push({ timestamp: tick.timestamp, ratio });

    // Prune old entries
    const maxAgeMs = this.config.lookback * 60_000;
    const cutoff = tick.timestamp - maxAgeMs;
    while (this.ratioHistory.length > 0 && this.ratioHistory[0].timestamp < cutoff) {
      this.ratioHistory.shift();
    }

    // Need warmup period
    if (this.ratioHistory.length < this.config.warmupPeriod) return;

    // Compute z-score
    const ratios = this.ratioHistory.map((r) => r.ratio);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const std = Math.sqrt(
      ratios.reduce((sum, r) => sum + (r - mean) ** 2, 0) / ratios.length,
    );
    if (std === 0) return;

    const z = (ratio - mean) / std;

    // Check exit
    if (this.position) {
      const elapsed = tick.timestamp - this.position.entryTimestamp;
      const maxHoldMs = this.config.maxHold * 60_000;

      const zReverted =
        (this.position.entryZ > 0 && z < this.config.exitZ) ||
        (this.position.entryZ < 0 && z > -this.config.exitZ);

      const zStopped =
        (this.position.entryZ > 0 && z > this.config.stopZ) ||
        (this.position.entryZ < 0 && z < -this.config.stopZ);

      const shouldExit = zReverted || zStopped || elapsed >= maxHoldMs;

      if (shouldExit) {
        if (ctx.broker instanceof BacktestBroker) {
          ctx.broker.setExitSignal({
            zScore: z,
            deviation: ratio,
            deviationMean: mean,
            deviationStd: std,
            impliedRate: mean,
            actualRate: ratio,
            legA: this.config.instrumentA,
            legAPrice: priceA,
            legB: this.config.instrumentB,
            legBPrice: priceB,
          });
        }

        await ctx.broker.closePosition(this.config.instrumentA);
        await ctx.broker.closePosition(this.config.instrumentB);
        this.position = null;
      }
      return;
    }

    // Skip weekends for entry
    const dayOfWeek = new Date(tick.timestamp).getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return;

    // Entry
    if (Math.abs(z) < this.config.entryZ) return;

    // Z > entry: spread too wide → short A, long B
    // Z < -entry: spread too narrow → long A, short B
    const sideA: "buy" | "sell" = z > 0 ? "sell" : "buy";
    const sideB: "buy" | "sell" = z > 0 ? "buy" : "sell";

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setEntrySignal({
        zScore: z,
        deviation: ratio,
        deviationMean: mean,
        deviationStd: std,
        impliedRate: mean,
        actualRate: ratio,
        legA: this.config.instrumentA,
        legAPrice: priceA,
        legB: this.config.instrumentB,
        legBPrice: priceB,
      });
    }

    await ctx.broker.submitOrder({
      instrument: this.config.instrumentA,
      side: sideA,
      type: "market",
      units: this.config.units,
    });

    await ctx.broker.submitOrder({
      instrument: this.config.instrumentB,
      side: sideB,
      type: "market",
      units: this.config.units,
    });

    this.position = {
      sideA,
      sideB,
      entryRatio: ratio,
      entryZ: z,
      entryTimestamp: tick.timestamp,
      entryPriceA: priceA,
      entryPriceB: priceB,
    };
  }

  async dispose(): Promise<void> {
    this.prices.clear();
    this.ratioHistory = [];
    this.position = null;
  }
}
