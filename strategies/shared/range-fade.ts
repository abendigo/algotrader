/**
 * Range Fade Strategy
 *
 * The opposite of London Breakout: most breakouts of the Asian range
 * are false breakouts that reverse. This strategy:
 *
 * 1. Measures the Asian session range (00:00-07:00 London time)
 * 2. Waits for a breakout above the high or below the low
 * 3. When price reverses back INSIDE the range, enters the fade:
 *    - If price broke above and came back → sell (false upside breakout)
 *    - If price broke below and came back → buy (false downside breakout)
 * 4. Target: opposite side of the Asian range
 * 5. Stop loss: beyond the breakout extreme
 *
 * This should have a higher win rate than breakout trading since most
 * intraday breakouts fail. The risk:reward is lower (~1:1) but
 * compensated by the higher win rate.
 *
 * Trades USD majors. Entry window: 08:00-14:00 London time.
 */

import type { Strategy, StrategyContext } from "../core/strategy.js";
import type { Instrument, Tick } from "../core/types.js";
import type { SignalSnapshot } from "../backtest/types.js";
import { BacktestBroker } from "../backtest/broker.js";
import { USD_MAJORS } from "../data/instruments.js";

export interface RangeFadeConfig {
  /** How far beyond the range price must go before we consider it a breakout (fraction of range, default: 0.1) */
  breakoutConfirmFraction: number;
  /** Take profit: fraction of range to target (default: 0.8 — nearly opposite side) */
  takeProfitRangeFraction: number;
  /** Stop loss: placed this far beyond the breakout extreme (fraction of range, default: 0.3) */
  stopBeyondExtremeFraction: number;
  /** Maximum Asian range as fraction of price (default: 0.004 = 0.4%) */
  maxRangePct: number;
  /** Minimum Asian range as fraction of price (default: 0.0003 = 0.03%) */
  minRangePct: number;
  /** Units per trade (default: 10000) */
  units: number;
  /** Which pairs to trade (default: USD majors) */
  instruments?: readonly string[];
}

const DEFAULT_CONFIG: RangeFadeConfig = {
  breakoutConfirmFraction: 0.1,
  takeProfitRangeFraction: 0.8,
  stopBeyondExtremeFraction: 0.3,
  maxRangePct: 0.004,
  minRangePct: 0.0003,
  units: 10_000,
};

interface InstrumentState {
  asianHigh: number;
  asianLow: number;
  brokeAbove: boolean;
  brokeBelow: boolean;
  breakoutExtreme: number; // highest point of upside breakout or lowest of downside
  traded: boolean; // only one fade per instrument per day
}

interface OpenPosition {
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  asianHigh: number;
  asianLow: number;
}

function getLocalTime(timestamp: number, timezone: string): { hour: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(timestamp));

  return {
    hour: parseInt(parts.find((p) => p.type === "hour")!.value, 10),
    min: parseInt(parts.find((p) => p.type === "minute")!.value, 10),
  };
}

export class RangeFadeStrategy implements Strategy {
  readonly name = "range-fade";

  private config: RangeFadeConfig;
  private instruments: readonly string[];
  private prices = new Map<Instrument, number>();
  private states = new Map<string, InstrumentState>();
  private positions = new Map<string, OpenPosition>();
  private currentDate = "";
  private rangesLocked = false;

  constructor(config?: Partial<RangeFadeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.instruments = this.config.instruments ?? USD_MAJORS;
  }

  async init(_ctx: StrategyContext): Promise<void> {}

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    if (!(this.instruments as readonly string[]).includes(tick.instrument)) return;

    const mid = (tick.bid + tick.ask) / 2;
    this.prices.set(tick.instrument, mid);

    const london = getLocalTime(tick.timestamp, "Europe/London");
    const londonMin = london.hour * 60 + london.min;
    const date = new Date(tick.timestamp);
    const dateStr = date.toISOString().slice(0, 10);
    const dayOfWeek = date.getUTCDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) return;

    // New day reset
    if (dateStr !== this.currentDate) {
      this.currentDate = dateStr;
      this.states.clear();
      this.rangesLocked = false;
    }

    // Initialize state for this instrument
    if (!this.states.has(tick.instrument)) {
      this.states.set(tick.instrument, {
        asianHigh: 0,
        asianLow: Infinity,
        brokeAbove: false,
        brokeBelow: false,
        breakoutExtreme: 0,
        traded: false,
      });
    }

    const state = this.states.get(tick.instrument)!;

    // Asian session: track range
    if (londonMin < 420 && !this.rangesLocked) {
      state.asianHigh = Math.max(state.asianHigh, mid);
      state.asianLow = Math.min(state.asianLow, mid);
      return;
    }

    if (londonMin >= 420 && !this.rangesLocked) {
      this.rangesLocked = true;
    }

    // Session end: close all positions at 16:00
    if (londonMin >= 960) {
      for (const [inst, pos] of this.positions) {
        if (ctx.broker instanceof BacktestBroker) {
          ctx.broker.setExitSignal(this.buildSignal(pos, mid, "session-end"));
        }
        await ctx.broker.closePosition(inst);
      }
      this.positions.clear();
      return;
    }

    // Check exits for open position
    const pos = this.positions.get(tick.instrument);
    if (pos) {
      await this.checkExit(ctx, tick, pos, mid);
      return;
    }

    // Entry window: 08:00 - 14:00 London time
    if (londonMin < 480 || londonMin >= 840) return;
    if (state.traded) return;

    const range = state.asianHigh - state.asianLow;
    if (range <= 0) return;
    const midRange = (state.asianHigh + state.asianLow) / 2;
    const rangePct = range / midRange;

    if (rangePct > this.config.maxRangePct || rangePct < this.config.minRangePct) return;

    const breakoutThreshold = range * this.config.breakoutConfirmFraction;

    // Track breakouts
    if (!state.brokeAbove && mid > state.asianHigh + breakoutThreshold) {
      state.brokeAbove = true;
      state.breakoutExtreme = mid;
    }
    if (state.brokeAbove && mid > state.breakoutExtreme) {
      state.breakoutExtreme = mid;
    }

    if (!state.brokeBelow && mid < state.asianLow - breakoutThreshold) {
      state.brokeBelow = true;
      state.breakoutExtreme = mid;
    }
    if (state.brokeBelow && mid < state.breakoutExtreme) {
      state.breakoutExtreme = mid;
    }

    // Fade: price broke above, now back inside range
    if (state.brokeAbove && !state.brokeBelow && mid < state.asianHigh) {
      const stopLoss = state.breakoutExtreme + range * this.config.stopBeyondExtremeFraction;
      const takeProfit = state.asianLow + range * (1 - this.config.takeProfitRangeFraction);

      state.traded = true;

      if (ctx.broker instanceof BacktestBroker) {
        ctx.broker.setEntrySignal(this.buildEntrySignal(state, mid, "sell", rangePct));
      }

      await ctx.broker.submitOrder({
        instrument: tick.instrument,
        side: "sell",
        type: "market",
        units: this.config.units,
      });

      this.positions.set(tick.instrument, {
        instrument: tick.instrument,
        side: "sell",
        entryPrice: mid,
        takeProfit,
        stopLoss,
        asianHigh: state.asianHigh,
        asianLow: state.asianLow,
      });
    }

    // Fade: price broke below, now back inside range
    if (state.brokeBelow && !state.brokeAbove && mid > state.asianLow) {
      const stopLoss = state.breakoutExtreme - range * this.config.stopBeyondExtremeFraction;
      const takeProfit = state.asianHigh - range * (1 - this.config.takeProfitRangeFraction);

      state.traded = true;

      if (ctx.broker instanceof BacktestBroker) {
        ctx.broker.setEntrySignal(this.buildEntrySignal(state, mid, "buy", rangePct));
      }

      await ctx.broker.submitOrder({
        instrument: tick.instrument,
        side: "buy",
        type: "market",
        units: this.config.units,
      });

      this.positions.set(tick.instrument, {
        instrument: tick.instrument,
        side: "buy",
        entryPrice: mid,
        takeProfit,
        stopLoss,
        asianHigh: state.asianHigh,
        asianLow: state.asianLow,
      });
    }
  }

  private async checkExit(
    ctx: StrategyContext,
    tick: Tick,
    pos: OpenPosition,
    currentPrice: number,
  ): Promise<void> {
    let shouldExit = false;
    let reason = "";

    if (pos.side === "buy") {
      if (currentPrice >= pos.takeProfit) { shouldExit = true; reason = "take-profit"; }
      if (currentPrice <= pos.stopLoss) { shouldExit = true; reason = "stop-loss"; }
    } else {
      if (currentPrice <= pos.takeProfit) { shouldExit = true; reason = "take-profit"; }
      if (currentPrice >= pos.stopLoss) { shouldExit = true; reason = "stop-loss"; }
    }

    if (!shouldExit) return;

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setExitSignal(this.buildSignal(pos, currentPrice, reason));
    }

    await ctx.broker.closePosition(tick.instrument);
    this.positions.delete(tick.instrument);
  }

  private buildEntrySignal(
    state: InstrumentState,
    price: number,
    side: string,
    rangePct: number,
  ): SignalSnapshot {
    return {
      zScore: 0,
      deviation: rangePct * 100,
      deviationMean: 0,
      deviationStd: 0,
      impliedRate: state.asianHigh,
      actualRate: price,
      legA: `high=${state.asianHigh.toFixed(5)}`,
      legAPrice: state.asianHigh,
      legB: `low=${state.asianLow.toFixed(5)}`,
      legBPrice: state.asianLow,
    };
  }

  private buildSignal(pos: OpenPosition, currentPrice: number, reason: string): SignalSnapshot {
    return {
      zScore: 0,
      deviation: 0,
      deviationMean: 0,
      deviationStd: 0,
      impliedRate: pos.takeProfit,
      actualRate: currentPrice,
      legA: `SL=${pos.stopLoss.toFixed(5)}`,
      legAPrice: pos.stopLoss,
      legB: reason,
      legBPrice: 0,
    };
  }

  async dispose(): Promise<void> {
    this.prices.clear();
    this.positions.clear();
    this.states.clear();
  }
}
