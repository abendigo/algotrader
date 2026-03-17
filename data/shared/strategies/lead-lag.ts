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

import type { Strategy, StrategyContext, StrategyStateSnapshot, StrategyIndicator, StrategyPosition } from "#core/strategy.js";
import type { Instrument, Tick } from "#core/types.js";
import type { SignalSnapshot } from "#backtest/types.js";
import { BacktestBroker } from "#backtest/broker.js";
import {
  CROSSES,
  USD_MAJORS,
  parsePair,
  findTriangle,
  type Currency,
} from "#data/instruments.js";

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

export const strategyMeta = {
  name: "Lead-Lag Mean Reversion",
  description: "Trades cross-currency pairs back toward their USD-implied fair value. When the actual cross rate deviates from the implied rate (derived from two USD-leg majors), enter against the deviation expecting mean reversion.",
  configFields: {
    common: {
      entryZ: { label: "Entry z-score", type: "number" as const, default: 2.0, min: 0, step: 0.1 },
      exitZ: { label: "Exit z-score", type: "number" as const, default: 0.5, min: 0, step: 0.1 },
      lookback: { label: "Lookback (candles)", type: "number" as const, default: 60, min: 1 },
    },
    backtest: {},
    live: {
      units: { label: "Units", type: "number" as const, default: 10000, min: 1 },
    },
  },
};

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
  readonly hedging = "forbidden" as const;
  readonly instruments = [...USD_MAJORS, ...CROSSES];

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

  getState(): StrategyStateSnapshot {
    const warmingUp = this.crossStates.some(
      (s) => s.deviationHistory.length < this.config.lookback
    );
    const inPosition = this.openPositions.size > 0;

    let phase = "Scanning";
    if (warmingUp) {
      const minFill = Math.min(
        ...this.crossStates.map((s) => s.deviationHistory.length)
      );
      phase = `Warming up (${minFill}/${this.config.lookback})`;
    } else if (inPosition) {
      phase = `In position (${this.openPositions.size})`;
    }

    const indicators: StrategyIndicator[] = [];
    for (const state of this.crossStates) {
      const legAPrice = this.prices.get(state.legA);
      const legBPrice = this.prices.get(state.legB);
      const crossPrice = this.prices.get(state.cross);

      if (!legAPrice || !legBPrice || !crossPrice) {
        indicators.push({
          label: state.cross.replace("_", "/"),
          instrument: state.cross,
          value: "waiting for prices",
          signal: "neutral",
        });
        continue;
      }
      if (state.deviationHistory.length < this.config.lookback) {
        indicators.push({
          label: state.cross.replace("_", "/"),
          instrument: state.cross,
          value: `warming up ${state.deviationHistory.length}/${this.config.lookback}`,
          signal: "neutral",
        });
        continue;
      }

      const rateBase = toUsdRate(state.legA, legAPrice);
      const rateQuote = toUsdRate(state.legB, legBPrice);
      const implied = rateQuote / rateBase;
      const deviation = ((crossPrice - implied) / implied) * 100;
      const { mean, std } = rollingStats(state.deviationHistory);
      const z = std > 0 ? (deviation - mean) / std : 0;

      const hasPosition = this.openPositions.has(state.cross);
      let signal: StrategyIndicator["signal"] = "neutral";
      if (hasPosition) {
        signal = Math.abs(z) < this.config.exitZ ? "warn" : "neutral";
      } else if (Math.abs(z) > this.config.entryZ) {
        signal = z > 0 ? "sell" : "buy";
      }

      const decimals = state.cross.includes("JPY") ? 3 : 5;
      indicators.push({
        label: state.cross.replace("_", "/"),
        instrument: state.cross,
        value: `z=${z.toFixed(2)} | actual=${crossPrice.toFixed(decimals)} implied=${implied.toFixed(decimals)} | dev=${deviation.toFixed(4)}%`,
        signal,
      });
    }

    // Sort: positions first, then by absolute z-score descending
    indicators.sort((a, b) => {
      const aPos = this.openPositions.has(a.instrument ?? "") ? 1 : 0;
      const bPos = this.openPositions.has(b.instrument ?? "") ? 1 : 0;
      if (aPos !== bPos) return bPos - aPos;
      // Extract z value for sorting
      const aZ = Math.abs(parseFloat(a.value.match(/z=(-?[\d.]+)/)?.[1] ?? "0"));
      const bZ = Math.abs(parseFloat(b.value.match(/z=(-?[\d.]+)/)?.[1] ?? "0"));
      return bZ - aZ;
    });

    const positions: StrategyPosition[] = [];
    for (const cross of this.openPositions) {
      const crossPrice = this.prices.get(cross);
      positions.push({
        instrument: cross,
        side: "buy", // we don't track side here — the runner shows actual positions
        entryPrice: 0,
        detail: crossPrice ? `current=${crossPrice.toFixed(5)}` : undefined,
      });
    }

    return {
      phase,
      detail: `Entry: |z| > ${this.config.entryZ} | Exit: |z| < ${this.config.exitZ} | Lookback: ${this.config.lookback}`,
      indicators,
      positions,
    };
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
