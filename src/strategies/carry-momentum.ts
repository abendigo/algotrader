/**
 * Carry + Momentum Strategy
 *
 * Combines two well-documented edges:
 * 1. Carry: earn financing by being long high-yield, short low-yield currencies
 * 2. Momentum: only trade in the direction of the 3-month price trend
 *
 * How it works:
 * - Ranks all currencies by their implied yield (from financing rates)
 * - Goes long the top N high-yield pairs, short the bottom N low-yield pairs
 * - Only enters if the pair's momentum (long-term EMA slope) confirms direction
 * - Rebalances monthly — closes positions that no longer qualify, opens new ones
 * - Wide ATR-based stop loss for risk management (hold through normal volatility)
 * - No trailing stop — positions are held until rebalance or stop
 *
 * Parameters:
 *   - topN: how many pairs to hold (default: 3)
 *   - momentumPeriod: EMA period for momentum filter (default: 500 on M5 ≈ ~42 hours)
 *   - rebalanceBars: bars between rebalances (default: 8640 on M5 ≈ 30 days)
 *   - stopAtrMult: stop distance in ATR multiples (default: 10)
 *   - atrPeriod: ATR calculation period (default: 100)
 */

import type { Strategy, StrategyContext, StrategyStateSnapshot, StrategyIndicator, StrategyPosition } from "#core/strategy.js";
import type { Instrument, Tick } from "#core/types.js";
import { USD_MAJORS } from "#data/instruments.js";

export interface CarryMomentumConfig {
  /** How many pairs to hold long and short (default: 3 each) */
  topN: number;
  /** EMA period for momentum filter (default: 500) */
  momentumPeriod: number;
  /** Bars between rebalances (default: 8640 ≈ 30 days on M5) */
  rebalanceBars: number;
  /** Stop loss distance in ATR multiples (default: 10) */
  stopAtrMult: number;
  /** ATR period (default: 100) */
  atrPeriod: number;
  /** Units per position (default: 100) */
  units: number;
  /** Instruments to consider (default: USD majors) */
  instruments?: readonly string[];
}

export const strategyMeta = {
  name: "Carry Momentum",
  description: "Combines carry (financing income) with momentum (trend confirmation). Holds high-yield longs and low-yield shorts, rebalances monthly.",
  recovery: { mode: "clean" as const },
  configFields: {
    common: {
      units: { label: "Units", type: "number" as const, default: 100, min: 1 },
      instruments: { label: "Pairs", type: "text" as const, placeholder: "EUR_USD,GBP_USD (blank = all majors)" },
      topN: { label: "Top N pairs", type: "number" as const, default: 3, min: 1, step: 1 },
      momentumPeriod: { label: "Momentum EMA", type: "number" as const, default: 500, min: 10 },
      rebalanceBars: { label: "Rebalance interval (hours)", type: "number" as const, default: 1080, min: 24 },
      stopAtrMult: { label: "Stop (ATR mult)", type: "number" as const, default: 30, min: 1, step: 0.5 },
      atrPeriod: { label: "ATR period", type: "number" as const, default: 100, min: 10 },
    },
    backtest: {},
    live: {},
  },
};

const DEFAULT_CONFIG: CarryMomentumConfig = {
  topN: 3,
  momentumPeriod: 500,
  rebalanceBars: 8640,
  stopAtrMult: 10,
  atrPeriod: 100,
  units: 100,
};

// Approximate annual financing rates (long rate).
// Positive = you earn by being long. Negative = you pay.
// The carry score for a pair is: longRate (positive = good to be long, negative = good to be short)
const CARRY_SCORES: Record<string, number> = {
  EUR_USD: -0.0215,   // pay to be long (EUR yields less than USD)
  GBP_USD: -0.0065,   // slight pay
  USD_JPY: 0.0485,    // earn to be long (USD yields much more than JPY)
  USD_CAD: 0.0045,    // slight earn
  USD_CHF: 0.0345,    // earn (USD yields more than CHF)
  AUD_USD: -0.0130,   // pay
  NZD_USD: -0.0015,   // roughly neutral
};

interface InstrumentState {
  prices: number[];
  ema: number | null;
  emaMult: number;
  atrValues: number[];
  prevClose: number | null;
  tickCount: number;
}

interface OpenPosition {
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  stopLoss: number;
}

export class CarryMomentumStrategy implements Strategy {
  readonly name = "carry-momentum";
  readonly hedging = "forbidden" as const;

  private config: CarryMomentumConfig;
  readonly instruments: readonly string[];
  private states = new Map<string, InstrumentState>();
  private positions = new Map<string, OpenPosition>();
  private prices = new Map<string, number>();
  private totalBars = 0;
  private lastRebalanceBar = 0;
  private lastBarHour = -1;
  private warmedUp = false;

  constructor(config?: Record<string, unknown>) {
    const cleaned: Record<string, unknown> = {};
    if (config) {
      for (const [k, v] of Object.entries(config)) {
        if (v !== "" && v != null) cleaned[k] = v;
      }
    }
    this.config = { ...DEFAULT_CONFIG, ...cleaned } as CarryMomentumConfig;
    this.instruments = (this.config.instruments && this.config.instruments.length > 0)
      ? this.config.instruments : USD_MAJORS;
  }

  async init(_ctx: StrategyContext): Promise<void> {
    for (const inst of this.instruments) {
      this.states.set(inst, {
        prices: [],
        ema: null,
        emaMult: 2 / (this.config.momentumPeriod + 1),
        atrValues: [],
        prevClose: null,
        tickCount: 0,
      });
    }
  }

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    if (!(this.instruments as readonly string[]).includes(tick.instrument)) return;

    const mid = (tick.bid + tick.ask) / 2;
    this.prices.set(tick.instrument, mid);

    const state = this.states.get(tick.instrument)!;
    state.tickCount++;

    // Update EMA
    if (state.ema === null) {
      state.ema = mid;
    } else {
      state.ema = (mid - state.ema) * state.emaMult + state.ema;
    }

    // Update ATR
    if (state.prevClose !== null) {
      const tr = Math.max(
        Math.abs(mid - state.prevClose),
        Math.abs(mid - state.prevClose), // simplified for single-price ticks
      );
      state.atrValues.push(tr);
      if (state.atrValues.length > this.config.atrPeriod) state.atrValues.shift();
    }
    state.prevClose = mid;

    // Check stop losses on open positions
    const pos = this.positions.get(tick.instrument);
    if (pos) {
      let stopped = false;
      if (pos.side === "buy" && mid <= pos.stopLoss) stopped = true;
      if (pos.side === "sell" && mid >= pos.stopLoss) stopped = true;
      if (stopped) {
        await ctx.broker.closePosition(tick.instrument);
        this.positions.delete(tick.instrument);
      }
    }

    // Count hourly bars (dedup by hour so live ticks don't over-count)
    if (tick.instrument === this.instruments[0]) {
      const hour = Math.floor(tick.timestamp / 3600_000);
      if (hour === this.lastBarHour) return;
      this.lastBarHour = hour;
      this.totalBars++;

      // Wait for warmup
      if (!this.warmedUp) {
        const allWarmed = [...this.states.values()].every(
          (s) => s.tickCount >= this.config.momentumPeriod && s.atrValues.length >= this.config.atrPeriod,
        );
        if (allWarmed) this.warmedUp = true;
        else return;
      }

      // Rebalance check
      if (this.totalBars - this.lastRebalanceBar >= this.config.rebalanceBars || this.lastRebalanceBar === 0) {
        await this.rebalance(ctx);
        this.lastRebalanceBar = this.totalBars;
      }
    }
  }

  private async rebalance(ctx: StrategyContext): Promise<void> {
    // Score each instrument: carry score + momentum confirmation
    interface ScoredInstrument {
      instrument: string;
      carryScore: number;
      momentum: "up" | "down" | "neutral";
      atr: number;
    }

    const scored: ScoredInstrument[] = [];

    for (const inst of this.instruments) {
      const carry = CARRY_SCORES[inst] ?? 0;
      const state = this.states.get(inst)!;
      const price = this.prices.get(inst);
      if (!price || !state.ema || state.atrValues.length < this.config.atrPeriod) continue;

      const atr = state.atrValues.reduce((s, v) => s + v, 0) / state.atrValues.length;
      const momentum = price > state.ema ? "up" : price < state.ema ? "down" : "neutral";

      scored.push({ instrument: inst, carryScore: carry, momentum, atr });
    }

    // Sort by carry score descending
    scored.sort((a, b) => b.carryScore - a.carryScore);

    // Top N for long (high carry + upward momentum)
    const longCandidates = scored
      .filter((s) => s.carryScore > 0 && s.momentum === "up")
      .slice(0, this.config.topN);

    // Bottom N for short (negative carry + downward momentum)
    const shortCandidates = scored
      .filter((s) => s.carryScore < 0 && s.momentum === "down")
      .reverse() // most negative first
      .slice(0, this.config.topN);

    // Determine target portfolio
    const targets = new Map<string, "buy" | "sell">();
    for (const c of longCandidates) targets.set(c.instrument, "buy");
    for (const c of shortCandidates) targets.set(c.instrument, "sell");

    // Close positions that are no longer in the target portfolio
    for (const [inst, pos] of this.positions) {
      const targetSide = targets.get(inst);
      if (!targetSide || targetSide !== pos.side) {
        await ctx.broker.closePosition(inst);
        this.positions.delete(inst);
      }
    }

    // Open new positions
    for (const [inst, side] of targets) {
      if (this.positions.has(inst)) continue; // already in position

      const s = scored.find((x) => x.instrument === inst);
      if (!s) continue;

      const price = this.prices.get(inst);
      if (!price) continue;

      const stopDist = s.atr * this.config.stopAtrMult;
      const stopLoss = side === "buy" ? price - stopDist : price + stopDist;

      await ctx.broker.submitOrder({
        instrument: inst,
        side,
        type: "market",
        units: this.config.units,
      });

      this.positions.set(inst, {
        instrument: inst,
        side,
        entryPrice: price,
        stopLoss,
      });
    }
  }

  getState(): StrategyStateSnapshot {
    const indicators: StrategyIndicator[] = [];
    for (const inst of this.instruments) {
      const state = this.states.get(inst);
      const price = this.prices.get(inst);
      if (!state || !price) continue;

      const carry = CARRY_SCORES[inst] ?? 0;
      const momentum = state.ema ? (price > state.ema ? "up" : "down") : "?";
      const decimals = inst.includes("JPY") ? 3 : 5;

      let signal: StrategyIndicator["signal"] = "neutral";
      if (carry > 0 && momentum === "up") signal = "buy";
      if (carry < 0 && momentum === "down") signal = "sell";

      indicators.push({
        label: inst.replace("_", "/"),
        instrument: inst,
        value: `carry=${(carry * 100).toFixed(2)}% mom=${momentum} ema=${state.ema?.toFixed(decimals) ?? "?"}`,
        signal,
      });
    }

    const positions: StrategyPosition[] = [];
    for (const [, pos] of this.positions) {
      const price = this.prices.get(pos.instrument) ?? pos.entryPrice;
      const pnl = pos.side === "buy" ? price - pos.entryPrice : pos.entryPrice - price;
      positions.push({
        instrument: pos.instrument,
        side: pos.side,
        entryPrice: pos.entryPrice,
        pnl,
        detail: `stop=${pos.stopLoss.toFixed(5)}`,
      });
    }

    const barsToRebalance = this.config.rebalanceBars - (this.totalBars - this.lastRebalanceBar);
    return {
      phase: this.warmedUp ? `Holding ${this.positions.size} positions` : "Warming up indicators",
      detail: this.warmedUp ? `Rebalance in ${barsToRebalance} bars` : `${this.totalBars}/${this.config.momentumPeriod} bars`,
      indicators,
      positions,
    };
  }

  async dispose(): Promise<void> {
    this.states.clear();
    this.positions.clear();
    this.prices.clear();
  }
}
