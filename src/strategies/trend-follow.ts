/**
 * Trend Following Strategy
 *
 * Identifies long-term trends using EMA crossovers and opens positions
 * in the trend direction. Never closes positions manually — relies
 * entirely on stop losses and trailing stops for exits.
 *
 * Entry:
 *   - Fast EMA crosses above slow EMA → buy
 *   - Fast EMA crosses below slow EMA → sell
 *   - Only one position per instrument at a time
 *   - Requires ADX above threshold to confirm trend strength
 *
 * Exit:
 *   - Initial stop loss at entry price ± (ATR × stopAtrMult)
 *   - Trailing stop activates when price moves favorably by (ATR × trailActivateAtrMult)
 *   - Trail distance: ATR × trailAtrMult
 *   - Strategy NEVER calls closePosition — only stops trigger exits
 *
 * Parameters:
 *   - fastPeriod: fast EMA period (default: 20 = ~1.7 hours on M5)
 *   - slowPeriod: slow EMA period (default: 80 = ~6.7 hours on M5)
 *   - atrPeriod: ATR period for stop/trail calculation (default: 40)
 *   - adxPeriod: ADX period for trend strength (default: 28)
 *   - adxThreshold: minimum ADX to enter (default: 20)
 *   - stopAtrMult: initial stop distance in ATR multiples (default: 2.0)
 *   - trailActivateAtrMult: ATR multiples before trailing activates (default: 1.5)
 *   - trailAtrMult: trailing stop distance in ATR multiples (default: 2.0)
 */

import type { Strategy, StrategyContext, StrategyStateSnapshot, StrategyIndicator, StrategyPosition } from "#core/strategy.js";
import type { Instrument, Tick } from "#core/types.js";
import { BacktestBroker } from "#backtest/broker.js";
import { USD_MAJORS } from "#data/instruments.js";

export interface TrendFollowConfig {
  fastPeriod: number;
  slowPeriod: number;
  atrPeriod: number;
  adxPeriod: number;
  adxThreshold: number;
  stopAtrMult: number;
  trailActivateAtrMult: number;
  trailAtrMult: number;
  /** How close price must get to fast EMA to count as a pullback (ATR mult, default: 0.5) */
  pullbackAtrMult: number;
  /** Rolling window of recent trades per instrument for adaptive filtering (default: 0 = disabled) */
  adaptiveWindow: number;
  /** Minimum win rate in the rolling window to keep trading a pair (default: 0.4 = 40%) */
  adaptiveMinWinRate: number;
  units: number;
  instruments?: readonly string[];
}

export const strategyMeta = {
  name: "Trend Follow",
  description: "Follows long-term trends using EMA crossovers with ATR-based stops and trailing stops. Never manually closes positions.",
  recovery: { mode: "clean" as const },
  configFields: {
    common: {
      units: { label: "Units", type: "number" as const, default: 100, min: 1 },
      instruments: { label: "Pairs", type: "text" as const, placeholder: "EUR_USD,GBP_USD (blank = all)" },
      fastPeriod: { label: "Fast EMA", type: "number" as const, default: 20, min: 2 },
      slowPeriod: { label: "Slow EMA", type: "number" as const, default: 80, min: 5 },
      atrPeriod: { label: "ATR Period", type: "number" as const, default: 40, min: 5 },
      adxPeriod: { label: "ADX Period", type: "number" as const, default: 28, min: 5 },
      adxThreshold: { label: "ADX Threshold", type: "number" as const, default: 20, min: 0, step: 1 },
      stopAtrMult: { label: "Stop (ATR mult)", type: "number" as const, default: 2.0, min: 0.5, step: 0.1 },
      trailActivateAtrMult: { label: "Trail activate (ATR mult)", type: "number" as const, default: 1.5, min: 0.5, step: 0.1 },
      trailAtrMult: { label: "Trail distance (ATR mult)", type: "number" as const, default: 2.0, min: 0.5, step: 0.1 },
      pullbackAtrMult: { label: "Pullback threshold (ATR mult)", type: "number" as const, default: 0.5, min: 0, step: 0.1 },
      adaptiveWindow: { label: "Adaptive window (trades)", type: "number" as const, default: 0, min: 0, step: 1 },
      adaptiveMinWinRate: { label: "Min win rate to trade", type: "number" as const, default: 0.4, min: 0, step: 0.05 },
    },
    backtest: {},
    live: {},
  },
};

const DEFAULT_CONFIG: TrendFollowConfig = {
  fastPeriod: 20,
  slowPeriod: 80,
  atrPeriod: 40,
  adxPeriod: 28,
  adxThreshold: 20,
  stopAtrMult: 2.0,
  trailActivateAtrMult: 1.5,
  trailAtrMult: 2.0,
  pullbackAtrMult: 0.5,
  adaptiveWindow: 0,
  adaptiveMinWinRate: 0.4,
  units: 100,
};

interface PriceBar {
  high: number;
  low: number;
  close: number;
}

interface OpenPosition {
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  stopLoss: number;
  trailingActive: boolean;
  peakPrice: number;
  atrAtEntry: number;
}

/** Exponential Moving Average calculator */
class EMA {
  private value: number | null = null;
  private mult: number;

  constructor(private period: number) {
    this.mult = 2 / (period + 1);
  }

  update(price: number): number {
    if (this.value === null) {
      this.value = price;
    } else {
      this.value = (price - this.value) * this.mult + this.value;
    }
    return this.value;
  }

  get(): number | null { return this.value; }
}

/** Average True Range calculator */
class ATR {
  private values: number[] = [];
  private prevClose: number | null = null;

  constructor(private period: number) {}

  update(bar: PriceBar): number | null {
    let tr: number;
    if (this.prevClose === null) {
      tr = bar.high - bar.low;
    } else {
      tr = Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - this.prevClose),
        Math.abs(bar.low - this.prevClose),
      );
    }
    this.prevClose = bar.close;
    this.values.push(tr);
    if (this.values.length > this.period) this.values.shift();
    if (this.values.length < this.period) return null;
    return this.values.reduce((s, v) => s + v, 0) / this.values.length;
  }

  get(): number | null {
    if (this.values.length < this.period) return null;
    return this.values.reduce((s, v) => s + v, 0) / this.values.length;
  }
}

/** ADX (Average Directional Index) calculator */
class ADX {
  private period: number;
  private prevHigh: number | null = null;
  private prevLow: number | null = null;
  private prevClose: number | null = null;
  private smoothedPlusDM: number = 0;
  private smoothedMinusDM: number = 0;
  private smoothedTR: number = 0;
  private dxValues: number[] = [];
  private adxValue: number | null = null;
  private count = 0;

  constructor(period: number) {
    this.period = period;
  }

  update(bar: PriceBar): number | null {
    if (this.prevHigh === null) {
      this.prevHigh = bar.high;
      this.prevLow = bar.low;
      this.prevClose = bar.close;
      return null;
    }

    const plusDM = Math.max(bar.high - this.prevHigh!, 0);
    const minusDM = Math.max(this.prevLow! - bar.low, 0);
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - this.prevClose!),
      Math.abs(bar.low - this.prevClose!),
    );

    // Suppress smaller DM
    const finalPlusDM = plusDM > minusDM ? plusDM : 0;
    const finalMinusDM = minusDM > plusDM ? minusDM : 0;

    this.count++;

    if (this.count <= this.period) {
      this.smoothedPlusDM += finalPlusDM;
      this.smoothedMinusDM += finalMinusDM;
      this.smoothedTR += tr;
    } else {
      this.smoothedPlusDM = this.smoothedPlusDM - (this.smoothedPlusDM / this.period) + finalPlusDM;
      this.smoothedMinusDM = this.smoothedMinusDM - (this.smoothedMinusDM / this.period) + finalMinusDM;
      this.smoothedTR = this.smoothedTR - (this.smoothedTR / this.period) + tr;
    }

    this.prevHigh = bar.high;
    this.prevLow = bar.low;
    this.prevClose = bar.close;

    if (this.count < this.period) return null;

    const plusDI = this.smoothedTR > 0 ? (this.smoothedPlusDM / this.smoothedTR) * 100 : 0;
    const minusDI = this.smoothedTR > 0 ? (this.smoothedMinusDM / this.smoothedTR) * 100 : 0;
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

    this.dxValues.push(dx);
    if (this.dxValues.length > this.period) this.dxValues.shift();

    if (this.dxValues.length < this.period) return null;

    if (this.adxValue === null) {
      this.adxValue = this.dxValues.reduce((s, v) => s + v, 0) / this.period;
    } else {
      this.adxValue = (this.adxValue * (this.period - 1) + dx) / this.period;
    }

    return this.adxValue;
  }

  get(): number | null { return this.adxValue; }
}

interface PendingEntry {
  side: "buy" | "sell";
  pulledBack: boolean;
  pullbackExtreme: number; // lowest point (for buy) or highest point (for sell) during pullback
}

interface InstrumentState {
  fastEma: EMA;
  slowEma: EMA;
  atr: ATR;
  adx: ADX;
  prevFastAboveSlow: boolean | null;
  barHigh: number;
  barLow: number;
  barClose: number;
  tickCount: number;
  pending: PendingEntry | null;
}

export class TrendFollowStrategy implements Strategy {
  readonly name = "trend-follow";
  readonly hedging = "forbidden" as const;

  private config: TrendFollowConfig;
  readonly instruments: readonly string[];
  private states = new Map<string, InstrumentState>();
  private positions = new Map<string, OpenPosition>();
  private prices = new Map<string, number>();
  /** Rolling trade results per instrument: true = win, false = loss */
  private tradeHistory = new Map<string, boolean[]>();

  constructor(config?: Record<string, unknown>) {
    const cleaned: Record<string, unknown> = {};
    if (config) {
      for (const [k, v] of Object.entries(config)) {
        if (v !== "" && v != null) cleaned[k] = v;
      }
    }
    this.config = { ...DEFAULT_CONFIG, ...cleaned } as TrendFollowConfig;
    this.instruments = (this.config.instruments && this.config.instruments.length > 0)
      ? this.config.instruments : USD_MAJORS;
  }

  async init(_ctx: StrategyContext): Promise<void> {
    for (const inst of this.instruments) {
      this.states.set(inst, {
        fastEma: new EMA(this.config.fastPeriod),
        slowEma: new EMA(this.config.slowPeriod),
        atr: new ATR(this.config.atrPeriod),
        adx: new ADX(this.config.adxPeriod),
        prevFastAboveSlow: null,
        barHigh: 0,
        barLow: Infinity,
        barClose: 0,
        tickCount: 0,
        pending: null,
      });
    }
  }

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    if (!(this.instruments as readonly string[]).includes(tick.instrument)) return;

    const mid = (tick.bid + tick.ask) / 2;
    this.prices.set(tick.instrument, mid);

    const state = this.states.get(tick.instrument)!;

    // Build bars from ticks (aggregate every 5 ticks as a pseudo-bar for M5)
    // In backtest, each tick IS a candle close, so we just use it directly
    state.tickCount++;
    if (mid > state.barHigh) state.barHigh = mid;
    if (mid < state.barLow) state.barLow = mid;
    state.barClose = mid;

    const bar: PriceBar = { high: state.barHigh, low: state.barLow, close: mid };

    // Update indicators
    const fastVal = state.fastEma.update(mid);
    const slowVal = state.slowEma.update(mid);
    const atrVal = state.atr.update(bar);
    const adxVal = state.adx.update(bar);

    // Reset bar tracking
    state.barHigh = mid;
    state.barLow = mid;

    // Check stop loss / trailing stop on open position
    const pos = this.positions.get(tick.instrument);
    if (pos) {
      // Update peak price
      if (pos.side === "buy" && mid > pos.peakPrice) pos.peakPrice = mid;
      if (pos.side === "sell" && mid < pos.peakPrice) pos.peakPrice = mid;

      // Check trailing stop activation
      if (!pos.trailingActive && atrVal) {
        const activateDist = atrVal * this.config.trailActivateAtrMult;
        if (pos.side === "buy" && mid - pos.entryPrice >= activateDist) {
          pos.trailingActive = true;
        }
        if (pos.side === "sell" && pos.entryPrice - mid >= activateDist) {
          pos.trailingActive = true;
        }
      }

      // Update trailing stop
      if (pos.trailingActive && atrVal) {
        const trailDist = atrVal * this.config.trailAtrMult;
        if (pos.side === "buy") {
          const trailStop = pos.peakPrice - trailDist;
          if (trailStop > pos.stopLoss) pos.stopLoss = trailStop;
        } else {
          const trailStop = pos.peakPrice + trailDist;
          if (trailStop < pos.stopLoss) pos.stopLoss = trailStop;
        }
      }

      // Check if stop hit
      let stopped = false;
      if (pos.side === "buy" && mid <= pos.stopLoss) stopped = true;
      if (pos.side === "sell" && mid >= pos.stopLoss) stopped = true;

      if (stopped) {
        // Record trade result for adaptive filtering
        const pnl = pos.side === "buy" ? mid - pos.entryPrice : pos.entryPrice - mid;
        this.recordTradeResult(tick.instrument, pnl > 0);

        await ctx.broker.closePosition(tick.instrument);
        this.positions.delete(tick.instrument);
      }

      return; // don't open new position while in one
    }

    // Need indicators to be warmed up
    if (!atrVal || !adxVal || state.prevFastAboveSlow === null) {
      state.prevFastAboveSlow = fastVal > slowVal;
      return;
    }

    // Detect EMA crossover
    const fastAboveSlow = fastVal > slowVal;
    const crossed = fastAboveSlow !== state.prevFastAboveSlow;
    state.prevFastAboveSlow = fastAboveSlow;

    // New crossover — set up a pending entry (cancel any existing)
    if (crossed && adxVal >= this.config.adxThreshold && this.shouldTradePair(tick.instrument)) {
      const side: "buy" | "sell" = fastAboveSlow ? "buy" : "sell";
      state.pending = { side, pulledBack: false, pullbackExtreme: mid };
      return;
    }

    // Cancel pending if ADX drops below threshold
    if (state.pending && adxVal < this.config.adxThreshold) {
      state.pending = null;
      return;
    }

    // No pending entry — nothing to do
    if (!state.pending) return;

    const pending = state.pending;
    const pullbackThreshold = atrVal * this.config.pullbackAtrMult;

    // Phase 1: Wait for pullback toward fast EMA
    if (!pending.pulledBack) {
      const distToFastEma = pending.side === "buy"
        ? mid - fastVal  // for buy, price should come down toward fast EMA
        : fastVal - mid;  // for sell, price should come up toward fast EMA

      // Track the extreme of the pullback
      if (pending.side === "buy" && mid < pending.pullbackExtreme) pending.pullbackExtreme = mid;
      if (pending.side === "sell" && mid > pending.pullbackExtreme) pending.pullbackExtreme = mid;

      // Price is close enough to fast EMA — pullback confirmed
      if (distToFastEma <= pullbackThreshold) {
        pending.pulledBack = true;
        pending.pullbackExtreme = mid;
      }
      return;
    }

    // Phase 2: Pullback happened — wait for price to resume trend direction
    let resumed = false;
    if (pending.side === "buy" && mid > pending.pullbackExtreme) {
      resumed = true;
    }
    if (pending.side === "sell" && mid < pending.pullbackExtreme) {
      resumed = true;
    }

    // Track extreme while waiting
    if (pending.side === "buy" && mid < pending.pullbackExtreme) pending.pullbackExtreme = mid;
    if (pending.side === "sell" && mid > pending.pullbackExtreme) pending.pullbackExtreme = mid;

    if (!resumed) return;

    // Enter the trade
    const stopDist = atrVal * this.config.stopAtrMult;
    const stopLoss = pending.side === "buy" ? mid - stopDist : mid + stopDist;

    await ctx.broker.submitOrder({
      instrument: tick.instrument,
      side: pending.side,
      type: "market",
      units: this.config.units,
    });

    this.positions.set(tick.instrument, {
      instrument: tick.instrument,
      side: pending.side,
      entryPrice: mid,
      stopLoss,
      trailingActive: false,
      peakPrice: mid,
      atrAtEntry: atrVal,
    });

    state.pending = null;
  }

  private recordTradeResult(instrument: string, win: boolean): void {
    if (this.config.adaptiveWindow <= 0) return;
    const history = this.tradeHistory.get(instrument) ?? [];
    history.push(win);
    if (history.length > this.config.adaptiveWindow) {
      history.shift();
    }
    this.tradeHistory.set(instrument, history);
  }

  private shouldTradePair(instrument: string): boolean {
    if (this.config.adaptiveWindow <= 0) return true; // disabled
    const history = this.tradeHistory.get(instrument);
    if (!history || history.length < this.config.adaptiveWindow) return true; // not enough data yet
    const wins = history.filter(Boolean).length;
    const winRate = wins / history.length;
    return winRate >= this.config.adaptiveMinWinRate;
  }

  getState(): StrategyStateSnapshot {
    const indicators: StrategyIndicator[] = [];
    for (const inst of this.instruments) {
      const state = this.states.get(inst);
      const price = this.prices.get(inst);
      if (!state || !price) continue;

      const fast = state.fastEma.get();
      const slow = state.slowEma.get();
      const atr = state.atr.get();
      const adx = state.adx.get();
      if (!fast || !slow) continue;

      const decimals = inst.includes("JPY") ? 3 : 5;
      let signal: StrategyIndicator["signal"] = "neutral";
      if (fast > slow && adx && adx >= this.config.adxThreshold) signal = "buy";
      if (fast < slow && adx && adx >= this.config.adxThreshold) signal = "sell";

      indicators.push({
        label: inst.replace("_", "/"),
        instrument: inst,
        value: `Fast=${fast.toFixed(decimals)} Slow=${slow.toFixed(decimals)} ATR=${atr?.toFixed(decimals) ?? "?"} ADX=${adx?.toFixed(1) ?? "?"}`,
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
        detail: `stop=${pos.stopLoss.toFixed(5)} trail=${pos.trailingActive ? "on" : "off"} peak=${pos.peakPrice.toFixed(5)}`,
      });
    }

    return {
      phase: `Tracking ${this.instruments.length} instruments`,
      detail: `${this.positions.size} open positions`,
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
