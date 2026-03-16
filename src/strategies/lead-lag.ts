/**
 * Cross-Currency Lead-Lag Mean Reversion Strategy
 *
 * Hypothesis: cross pairs (e.g., AUD_CAD) reprice slower than their
 * USD-leg majors (AUD_USD, USD_CAD). When the actual cross rate deviates
 * from the implied rate (derived from the two majors), trade toward implied.
 *
 * Signal:
 *   implied = rateQuote / rateBase  (units of QUOTE per 1 BASE via USD)
 *   deviation% = (actual - implied) / implied * 100
 *   z-score = (deviation - mean) / std
 *
 * Entry: |z-score| > entryZ  →  sell cross if positive, buy if negative
 * Exit:  |z-score| < exitZ   →  close position
 */

import type { Strategy, StrategyContext } from "../core/strategy.js";
import type { Instrument, Tick } from "../core/types.js";
import type { SignalSnapshot } from "../backtest/types.js";
import { BacktestBroker } from "../backtest/broker.js";
import {
  CROSSES,
  USD_MAJORS,
  parsePair,
  findTriangle,
  type Currency,
} from "../data/instruments.js";

export interface LeadLagConfig {
  /** Z-score threshold to enter a trade (default: 2.0) */
  entryZ: number;
  /** Z-score threshold to exit a trade (default: 0.5) */
  exitZ: number;
  /** Rolling window size for mean/std of deviation (default: 60) */
  lookback: number;
  /** Units per trade (default: 10000 — 0.1 lot) */
  units: number;
  /** Which crosses to trade (default: all 21) */
  crosses?: readonly string[];
}

const DEFAULT_CONFIG: LeadLagConfig = {
  entryZ: 2.0,
  exitZ: 0.5,
  lookback: 60,
  units: 10_000,
};

interface CrossState {
  cross: string;
  legA: string; // USD-leg for base currency
  legB: string; // USD-leg for quote currency
  baseCcy: Currency;
  quoteCcy: Currency;
  deviationHistory: number[];
}

/**
 * Convert a pair's mid price to "units of currency per 1 USD".
 * XXX_USD → 1/price, USD_XXX → price
 */
function toUsdRate(instrument: string, price: number): number {
  const [base] = parsePair(instrument);
  return base === "USD" ? price : 1 / price;
}

export class LeadLagStrategy implements Strategy {
  readonly name = "lead-lag";

  private config: LeadLagConfig;
  private prices = new Map<Instrument, number>();
  private crossStates: CrossState[] = [];
  private openPositions = new Set<string>();

  constructor(config?: Partial<LeadLagConfig>) {
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
        deviationHistory: [],
      });
    }
  }

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    // Update latest price
    this.prices.set(tick.instrument, (tick.bid + tick.ask) / 2);

    // Only evaluate signals when a cross pair ticks
    // (that's when we'd potentially trade)
    const state = this.crossStates.find((s) => s.cross === tick.instrument);
    if (!state) return;

    // Need prices for both USD legs and the cross itself
    const legAPrice = this.prices.get(state.legA);
    const legBPrice = this.prices.get(state.legB);
    const crossPrice = this.prices.get(state.cross);
    if (!legAPrice || !legBPrice || !crossPrice) return;

    // Compute implied cross rate
    const rateBase = toUsdRate(state.legA, legAPrice);
    const rateQuote = toUsdRate(state.legB, legBPrice);
    const implied = rateQuote / rateBase;

    // Deviation as percentage
    const deviation = ((crossPrice - implied) / implied) * 100;
    state.deviationHistory.push(deviation);

    // Keep only the lookback window
    if (state.deviationHistory.length > this.config.lookback) {
      state.deviationHistory.shift();
    }

    // Need full window before trading
    if (state.deviationHistory.length < this.config.lookback) return;

    // Compute z-score
    const { mean, std } = rollingStats(state.deviationHistory);
    if (std === 0) return;
    const z = (deviation - mean) / std;

    const hasPosition = this.openPositions.has(state.cross);

    const buildSignal = (): SignalSnapshot => ({
      zScore: z,
      deviation,
      deviationMean: mean,
      deviationStd: std,
      impliedRate: implied,
      actualRate: crossPrice,
      legA: state.legA,
      legAPrice: legAPrice!,
      legB: state.legB,
      legBPrice: legBPrice!,
    });

    if (hasPosition) {
      // Exit: z-score reverted
      if (Math.abs(z) < this.config.exitZ) {
        if (ctx.broker instanceof BacktestBroker) {
          ctx.broker.setExitSignal(buildSignal());
        }
        await ctx.broker.closePosition(state.cross);
        this.openPositions.delete(state.cross);
      }
    } else {
      // Entry: z-score exceeds threshold
      if (Math.abs(z) > this.config.entryZ) {
        // Positive deviation (actual > implied) → sell cross (expect reversion down)
        // Negative deviation (actual < implied) → buy cross (expect reversion up)
        const side = z > 0 ? "sell" : "buy";
        if (ctx.broker instanceof BacktestBroker) {
          ctx.broker.setEntrySignal(buildSignal());
        }
        await ctx.broker.submitOrder({
          instrument: state.cross,
          side,
          type: "market",
          units: this.config.units,
        });
        this.openPositions.add(state.cross);
      }
    }
  }

  async dispose(): Promise<void> {
    this.crossStates = [];
    this.prices.clear();
    this.openPositions.clear();
  }
}

function rollingStats(arr: number[]): { mean: number; std: number } {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}
