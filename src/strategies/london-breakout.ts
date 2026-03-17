/**
 * London Breakout Strategy
 *
 * The Asian session (00:00-07:00 London time) establishes a tight range
 * as liquidity is low. When London opens (08:00), institutional flows
 * create a directional move. This strategy:
 *
 * 1. Measures the high/low range of each major pair during the Asian session
 * 2. At London open, places a breakout entry: buy if price breaks above
 *    the Asian high, sell if it breaks below the Asian low
 * 3. Holds until take profit, stop loss, or session end (London close)
 *
 * Only trades USD majors (tightest spreads). 0-7 trades per day.
 *
 * Key parameters:
 *   - Range period: 00:00-07:00 London time (Asian session)
 *   - Breakout confirmation: price must exceed range by minBreakout pips
 *   - Stop loss: opposite side of the Asian range
 *   - Take profit: risk × rewardRatio
 *   - Session end: 16:00 London time (close any open position)
 */

import type { Strategy, StrategyContext } from "../core/strategy.js";
import type { Instrument, Tick } from "../core/types.js";
import type { SignalSnapshot } from "../backtest/types.js";
import { BacktestBroker } from "../backtest/broker.js";
import { USD_MAJORS } from "../data/instruments.js";

export interface LondonBreakoutConfig {
  /** Minimum breakout beyond the Asian range to trigger entry (as fraction of range, default: 0.1) */
  minBreakoutFraction: number;
  /** Reward:risk ratio for take profit (default: 0 = disabled, exit at session end) */
  rewardRatio: number;
  /** Maximum Asian range as fraction of price — skip if too wide (default: 0.005 = 0.5%) */
  maxRangePct: number;
  /** Minimum Asian range as fraction of price — skip if too narrow (default: 0.0005 = 0.05%) */
  minRangePct: number;
  /** Fixed units per trade (used if riskPerTrade is 0) */
  units: number;
  /** Fraction of account equity to risk per trade (default: 0.03 = 3%). Overrides units. */
  riskPerTrade: number;
  /** Stop loss as fraction of Asian range from entry (default: 0.5 = midpoint of range). 1.0 = opposite side. */
  stopRangeFraction: number;
  /** Which pairs to trade (default: USD majors) */
  instruments?: readonly string[];
  /** Days of week to skip (0=Sun, 5=Fri, etc.) */
  skipDays?: number[];
  /** Activate trailing stop once PnL exceeds this fraction of Asian range (default: 0.5). 0 = disabled. */
  trailActivateFraction: number;
  /** Trail distance as fraction of Asian range behind the peak price (default: 0.3) */
  trailDistanceFraction: number;
}

const DEFAULT_CONFIG: LondonBreakoutConfig = {
  minBreakoutFraction: 0.1,
  rewardRatio: 0,
  maxRangePct: 0.005,
  minRangePct: 0.0005,
  units: 10_000,
  riskPerTrade: 0,
  stopRangeFraction: 1.0,
  trailActivateFraction: 0.5,
  trailDistanceFraction: 0.3,
};

interface AsianRange {
  instrument: string;
  high: number;
  low: number;
  rangePct: number;
}

interface OpenPosition {
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  asianHigh: number;
  asianLow: number;
  asianRange: number;
  peakPnl: number;
  peakPrice: number;
  trailingActive: boolean;
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

export class LondonBreakoutStrategy implements Strategy {
  readonly name = "london-breakout";

  private config: LondonBreakoutConfig;
  private prices = new Map<Instrument, number>();
  private instruments: readonly string[];

  // Asian range tracking (reset daily)
  private asianHighs = new Map<string, number>();
  private asianLows = new Map<string, number>();
  private rangesLocked = false; // true once London opens
  private currentDate = "";

  // Open positions
  private positions = new Map<string, OpenPosition>();

  constructor(config?: Partial<LondonBreakoutConfig>) {
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

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) return;
    if (this.config.skipDays?.includes(dayOfWeek)) return;

    // New day — reset ranges
    if (dateStr !== this.currentDate) {
      this.currentDate = dateStr;
      this.asianHighs.clear();
      this.asianLows.clear();
      this.rangesLocked = false;
    }

    // Asian session: 00:00 - 07:00 London time — track ranges
    if (londonMin < 420 && !this.rangesLocked) {
      const prevHigh = this.asianHighs.get(tick.instrument) ?? 0;
      const prevLow = this.asianLows.get(tick.instrument) ?? Infinity;
      this.asianHighs.set(tick.instrument, Math.max(prevHigh, mid));
      this.asianLows.set(tick.instrument, Math.min(prevLow, mid));
      return;
    }

    // Lock ranges at 07:00
    if (londonMin >= 420 && !this.rangesLocked) {
      this.rangesLocked = true;
    }

    // Session end: 16:00 London time — close all positions
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

    // Check exits for open position on this instrument
    const pos = this.positions.get(tick.instrument);
    if (pos) {
      await this.checkExit(ctx, tick, pos, mid);
      return;
    }

    // Entry window: 08:00 - 12:00 London time
    if (londonMin < 480 || londonMin >= 720) return;

    // Already have a position on this instrument today
    if (this.positions.has(tick.instrument)) return;

    // Check for breakout
    const asianHigh = this.asianHighs.get(tick.instrument);
    const asianLow = this.asianLows.get(tick.instrument);
    if (!asianHigh || !asianLow || asianHigh <= asianLow) return;

    const range = asianHigh - asianLow;
    const midPrice = (asianHigh + asianLow) / 2;
    const rangePct = range / midPrice;

    // Skip if range is too wide or too narrow
    if (rangePct > this.config.maxRangePct || rangePct < this.config.minRangePct) return;

    const minBreakout = range * this.config.minBreakoutFraction;

    let side: "buy" | "sell" | null = null;
    let stopLoss = 0;
    let takeProfit = 0;
    const sf = this.config.stopRangeFraction;

    if (mid > asianHigh + minBreakout) {
      // Breakout above Asian high — stop is sf × range below entry
      side = "buy";
      stopLoss = mid - range * sf;
      const risk = mid - stopLoss;
      takeProfit = this.config.rewardRatio > 0 ? mid + risk * this.config.rewardRatio : Infinity;
    } else if (mid < asianLow - minBreakout) {
      // Breakout below Asian low — stop is sf × range above entry
      side = "sell";
      stopLoss = mid + range * sf;
      const risk = stopLoss - mid;
      takeProfit = this.config.rewardRatio > 0 ? mid - risk * this.config.rewardRatio : -Infinity;
    }

    if (!side) return;

    // Compute position size based on risk
    let units = this.config.units;
    if (this.config.riskPerTrade > 0) {
      const account = await ctx.broker.getAccountSummary();
      const equity = account.balance + account.unrealizedPL;
      const maxRiskDollars = equity * this.config.riskPerTrade;
      const riskPerUnit = Math.abs(mid - stopLoss);
      if (riskPerUnit > 0) {
        units = Math.floor(maxRiskDollars / riskPerUnit);
        if (units < 1) return; // can't afford even 1 unit
      }
    }

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setEntrySignal({
        zScore: 0,
        deviation: rangePct * 100,
        deviationMean: 0,
        deviationStd: 0,
        impliedRate: asianHigh,
        actualRate: mid,
        legA: `high=${asianHigh.toFixed(5)}`,
        legAPrice: asianHigh,
        legB: `low=${asianLow.toFixed(5)}`,
        legBPrice: asianLow,
      });
    }

    await ctx.broker.submitOrder({
      instrument: tick.instrument,
      side,
      type: "market",
      units,
    });

    this.positions.set(tick.instrument, {
      instrument: tick.instrument,
      side,
      entryPrice: mid,
      takeProfit,
      stopLoss,
      asianHigh,
      asianLow,
      asianRange: range,
      peakPnl: 0,
      peakPrice: mid,
      trailingActive: false,
    });
  }

  private async checkExit(
    ctx: StrategyContext,
    tick: Tick,
    pos: OpenPosition,
    currentPrice: number,
  ): Promise<void> {
    const pnl =
      pos.side === "buy"
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;

    if (pnl > pos.peakPnl) pos.peakPnl = pnl;

    // Track peak price for trailing stop
    if (pos.side === "buy" && currentPrice > pos.peakPrice) pos.peakPrice = currentPrice;
    if (pos.side === "sell" && currentPrice < pos.peakPrice) pos.peakPrice = currentPrice;

    // Activate trailing stop once PnL exceeds threshold
    const trailActivate = this.config.trailActivateFraction;
    if (trailActivate > 0 && !pos.trailingActive && pnl >= pos.asianRange * trailActivate) {
      pos.trailingActive = true;
    }

    let shouldExit = false;
    let reason = "";

    // Original stop loss and take profit
    if (pos.side === "buy") {
      if (currentPrice >= pos.takeProfit) { shouldExit = true; reason = "take-profit"; }
      if (currentPrice <= pos.stopLoss) { shouldExit = true; reason = "stop-loss"; }
    } else {
      if (currentPrice <= pos.takeProfit) { shouldExit = true; reason = "take-profit"; }
      if (currentPrice >= pos.stopLoss) { shouldExit = true; reason = "stop-loss"; }
    }

    // Trailing stop
    if (pos.trailingActive && !shouldExit) {
      const trailDist = pos.asianRange * this.config.trailDistanceFraction;
      if (pos.side === "buy" && currentPrice <= pos.peakPrice - trailDist) {
        shouldExit = true;
        reason = "trailing-stop";
      }
      if (pos.side === "sell" && currentPrice >= pos.peakPrice + trailDist) {
        shouldExit = true;
        reason = "trailing-stop";
      }
    }

    if (!shouldExit) return;

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setExitSignal(this.buildSignal(pos, currentPrice, reason));
    }

    await ctx.broker.closePosition(tick.instrument);
    this.positions.delete(tick.instrument);
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
      legBPrice: pos.peakPnl,
    };
  }

  /** Get current strategy state for display/monitoring */
  getState(): {
    date: string;
    rangesLocked: boolean;
    asianRanges: { instrument: string; high: number; low: number; range: number }[];
    openPositions: {
      instrument: string;
      side: string;
      entryPrice: number;
      stopLoss: number;
      pnl: number;
      peakPnl: number;
      trailingActive: boolean;
    }[];
  } {
    const asianRanges = [];
    for (const inst of this.instruments) {
      const high = this.asianHighs.get(inst);
      const low = this.asianLows.get(inst);
      if (high && low && high > 0 && low < Infinity) {
        asianRanges.push({
          instrument: inst,
          high,
          low,
          range: high - low,
        });
      }
    }

    const openPositions = [];
    for (const [, pos] of this.positions) {
      const currentPrice = this.prices.get(pos.instrument) ?? pos.entryPrice;
      const pnl = pos.side === "buy"
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;
      openPositions.push({
        instrument: pos.instrument,
        side: pos.side,
        entryPrice: pos.entryPrice,
        stopLoss: pos.stopLoss,
        pnl,
        peakPnl: pos.peakPnl,
        trailingActive: pos.trailingActive,
      });
    }

    return {
      date: this.currentDate,
      rangesLocked: this.rangesLocked,
      asianRanges,
      openPositions,
    };
  }

  async dispose(): Promise<void> {
    this.prices.clear();
    this.positions.clear();
    this.asianHighs.clear();
    this.asianLows.clear();
  }
}
