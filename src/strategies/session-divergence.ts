/**
 * Session Open Divergence Strategy
 *
 * At the open of each major trading session (London, New York), scan all
 * crosses for the largest deviation from their USD-implied rate. Enter
 * the single most mispriced cross, betting that the influx of session
 * liquidity will push it back toward fair value.
 *
 * Trade frequency: 1-2 trades per day (one per session)
 * Hold time: up to maxHold candles (~2-4 hours on M1)
 * Target: larger moves (20-50+ pips) that justify spread costs
 *
 * Session windows (UTC):
 *   London:   08:00 - 08:15 (scan window), hold until 12:00 max
 *   New York: 13:00 - 13:15 (scan window), hold until 17:00 max
 *
 * Entry logic:
 *   1. At session open, compute deviation for all 21 crosses
 *   2. Pick the cross with the largest |deviation| that exceeds threshold
 *   3. Enter: sell if actual > implied, buy if actual < implied
 *
 * Exit logic:
 *   - Deviation reverts past exitPct of entry deviation (partial reversion)
 *   - Take profit hit (absolute price move)
 *   - Stop loss hit
 *   - Max hold time reached
 *   - Session end reached
 */

import type { Strategy, StrategyContext } from "../core/strategy.js";
import type { Instrument, Tick } from "../core/types.js";
import type { SignalSnapshot } from "../backtest/types.js";
import { BacktestBroker } from "../backtest/broker.js";
import {
  CROSSES,
  parsePair,
  findTriangle,
  type Currency,
} from "../data/instruments.js";

export interface SessionDivergenceConfig {
  /** Minimum deviation % to consider a trade (default: 0.01) */
  minDeviationPct: number;
  /** Exit when deviation reverts this fraction of entry deviation (default: 0.5 = 50%) */
  reversionTarget: number;
  /** Max candles to hold (default: 240 = 4 hours on M1) */
  maxHold: number;
  /** Take profit in price units as multiple of spread (default: 15) */
  takeProfitMultiple: number;
  /** Stop loss in price units as multiple of spread (default: 8) */
  stopLossMultiple: number;
  /** Units per trade (default: 10000) */
  units: number;
  /** Per-instrument spread for TP/SL calculation */
  spreads?: Record<string, number>;
  /** Which crosses to consider (default: all 21) */
  crosses?: readonly string[];
}

const DEFAULT_CONFIG: SessionDivergenceConfig = {
  minDeviationPct: 0.01,
  reversionTarget: 0.5,
  maxHold: 240,
  takeProfitMultiple: 15,
  stopLossMultiple: 8,
  units: 10_000,
};

interface Session {
  name: string;
  scanStartHour: number; // UTC hour
  scanEndHour: number;   // UTC hour (+ minutes via scanEndMin)
  scanEndMin: number;
  sessionEndHour: number;
}

const SESSIONS: Session[] = [
  { name: "London", scanStartHour: 8, scanEndHour: 8, scanEndMin: 15, sessionEndHour: 12 },
  { name: "New York", scanStartHour: 13, scanEndHour: 13, scanEndMin: 15, sessionEndHour: 17 },
];

interface CrossInfo {
  cross: string;
  legA: string;
  legB: string;
  baseCcy: Currency;
  quoteCcy: Currency;
}

interface OpenPosition {
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  entryDeviation: number;
  entryTimestamp: number;
  ticksSinceEntry: number;
  takeProfit: number;
  stopLoss: number;
  session: string;
  sessionEndHour: number;
}

function toUsdRate(instrument: string, price: number): number {
  const [base] = parsePair(instrument);
  return base === "USD" ? price : 1 / price;
}

export class SessionDivergenceStrategy implements Strategy {
  readonly name = "session-divergence";

  private config: SessionDivergenceConfig;
  private prices = new Map<Instrument, number>();
  private crossInfos: CrossInfo[] = [];
  private position: OpenPosition | null = null;
  private lastScanSession: string = "";
  private lastScanDate: string = "";

  constructor(config?: Partial<SessionDivergenceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(_ctx: StrategyContext): Promise<void> {
    const crosses = this.config.crosses ?? CROSSES;

    for (const cross of crosses) {
      const triangle = findTriangle(cross);
      if (!triangle) continue;

      const [baseCcy, quoteCcy] = parsePair(cross);
      this.crossInfos.push({
        cross,
        legA: triangle.legA,
        legB: triangle.legB,
        baseCcy: baseCcy as Currency,
        quoteCcy: quoteCcy as Currency,
      });
    }
  }

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    this.prices.set(tick.instrument, (tick.bid + tick.ask) / 2);

    const date = new Date(tick.timestamp);
    const hour = date.getUTCHours();
    const min = date.getUTCMinutes();
    const dateStr = date.toISOString().slice(0, 10);
    const dayOfWeek = date.getUTCDay();

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) return;

    // Manage open position
    if (this.position) {
      this.position.ticksSinceEntry++;
      await this.checkExit(ctx, tick);
      return;
    }

    // Check if we're in a session scan window
    for (const session of SESSIONS) {
      const inScanWindow =
        (hour === session.scanStartHour && min >= 0) &&
        (hour < session.scanEndHour || (hour === session.scanEndHour && min <= session.scanEndMin));

      if (!inScanWindow) continue;

      // Only scan once per session per day
      const scanKey = `${dateStr}-${session.name}`;
      if (this.lastScanSession === scanKey) continue;

      // Need all prices available
      const allPricesReady = this.crossInfos.every(
        (ci) =>
          this.prices.has(ci.cross) &&
          this.prices.has(ci.legA) &&
          this.prices.has(ci.legB),
      );
      if (!allPricesReady) continue;

      this.lastScanSession = scanKey;
      await this.scanAndEnter(ctx, tick, session);
    }
  }

  private async scanAndEnter(
    ctx: StrategyContext,
    tick: Tick,
    session: Session,
  ): Promise<void> {
    // Score all crosses by deviation
    const candidates: {
      info: CrossInfo;
      deviation: number;
      implied: number;
      actual: number;
      legAPrice: number;
      legBPrice: number;
    }[] = [];

    for (const info of this.crossInfos) {
      const crossPrice = this.prices.get(info.cross);
      const legAPrice = this.prices.get(info.legA);
      const legBPrice = this.prices.get(info.legB);
      if (!crossPrice || !legAPrice || !legBPrice) continue;

      const rateBase = toUsdRate(info.legA, legAPrice);
      const rateQuote = toUsdRate(info.legB, legBPrice);
      const implied = rateQuote / rateBase;
      const deviation = ((crossPrice - implied) / implied) * 100;

      if (Math.abs(deviation) >= this.config.minDeviationPct) {
        candidates.push({
          info,
          deviation,
          implied,
          actual: crossPrice,
          legAPrice,
          legBPrice,
        });
      }
    }

    if (candidates.length === 0) return;

    // Pick the most mispriced cross
    candidates.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
    const best = candidates[0];

    // Positive deviation: actual > implied → sell (expect reversion down)
    // Negative deviation: actual < implied → buy (expect reversion up)
    const side = best.deviation > 0 ? "sell" : "buy";

    const spreadCost = this.config.spreads?.[best.info.cross] ?? 0.0002;
    const takeProfit = spreadCost * this.config.takeProfitMultiple;
    const stopLoss = spreadCost * this.config.stopLossMultiple;

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setEntrySignal({
        zScore: best.deviation / this.config.minDeviationPct, // deviation relative to threshold
        deviation: best.deviation,
        deviationMean: 0,
        deviationStd: 0,
        impliedRate: best.implied,
        actualRate: best.actual,
        legA: best.info.legA,
        legAPrice: best.legAPrice,
        legB: best.info.legB,
        legBPrice: best.legBPrice,
      });
    }

    await ctx.broker.submitOrder({
      instrument: best.info.cross,
      side,
      type: "market",
      units: this.config.units,
    });

    this.position = {
      instrument: best.info.cross,
      side,
      entryPrice: best.actual,
      entryDeviation: best.deviation,
      entryTimestamp: tick.timestamp,
      ticksSinceEntry: 0,
      takeProfit,
      stopLoss,
      session: session.name,
      sessionEndHour: session.sessionEndHour,
    };
  }

  private async checkExit(ctx: StrategyContext, tick: Tick): Promise<void> {
    const pos = this.position!;
    const currentPrice = this.prices.get(pos.instrument);
    if (!currentPrice) return;

    const date = new Date(tick.timestamp);
    const hour = date.getUTCHours();

    // PnL check
    const pnl =
      pos.side === "buy"
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;

    // Compute current deviation to check reversion
    const info = this.crossInfos.find((ci) => ci.cross === pos.instrument);
    let currentDeviation = pos.entryDeviation; // fallback
    let implied = 0;
    let legAPrice = 0;
    let legBPrice = 0;

    if (info) {
      legAPrice = this.prices.get(info.legA) ?? 0;
      legBPrice = this.prices.get(info.legB) ?? 0;
      if (legAPrice && legBPrice) {
        const rateBase = toUsdRate(info.legA, legAPrice);
        const rateQuote = toUsdRate(info.legB, legBPrice);
        implied = rateQuote / rateBase;
        currentDeviation = ((currentPrice - implied) / implied) * 100;
      }
    }

    // Reversion: deviation has moved back toward zero by reversionTarget
    const reversionAchieved =
      Math.abs(pos.entryDeviation) > 0 &&
      Math.abs(currentDeviation) <=
        Math.abs(pos.entryDeviation) * (1 - this.config.reversionTarget);

    const shouldExit =
      pnl >= pos.takeProfit ||
      pnl <= -pos.stopLoss ||
      pos.ticksSinceEntry >= this.config.maxHold ||
      hour >= pos.sessionEndHour ||
      reversionAchieved;

    if (!shouldExit) return;

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setExitSignal({
        zScore: currentDeviation / this.config.minDeviationPct,
        deviation: currentDeviation,
        deviationMean: 0,
        deviationStd: 0,
        impliedRate: implied,
        actualRate: currentPrice,
        legA: info?.legA ?? "",
        legAPrice,
        legB: info?.legB ?? "",
        legBPrice,
      });
    }

    await ctx.broker.closePosition(pos.instrument);
    this.position = null;
  }

  async dispose(): Promise<void> {
    this.crossInfos = [];
    this.prices.clear();
    this.position = null;
  }
}
