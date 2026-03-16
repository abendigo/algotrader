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
  /** Minimum deviation % to consider a trade (default: 0.03) */
  minDeviationPct: number;
  /** Exit when deviation reverts this fraction of entry deviation (default: 0.7 = 70%) */
  reversionTarget: number;
  /** Minimum candles to hold before allowing exit (default: 30 = 30 min on M1) */
  minHold: number;
  /** Max candles to hold (default: 240 = 4 hours on M1) */
  maxHold: number;
  /** Take profit in price units as multiple of spread (default: 20) */
  takeProfitMultiple: number;
  /** Stop loss in price units as multiple of spread (default: 10) */
  stopLossMultiple: number;
  /** Units per trade (default: 10000) */
  units: number;
  /** Per-instrument spread for TP/SL calculation */
  spreads?: Record<string, number>;
  /** Which crosses to consider (default: all 21) */
  crosses?: readonly string[];
  /** Don't trade the same cross again for this many candles (default: 480 = 8 hours on M1) */
  cooldownPeriod: number;
}

const DEFAULT_CONFIG: SessionDivergenceConfig = {
  minDeviationPct: 0.03,
  reversionTarget: 0.7,
  minHold: 30,
  maxHold: 240,
  takeProfitMultiple: 20,
  stopLossMultiple: 10,
  units: 10_000,
  cooldownPeriod: 480,
};

interface Session {
  name: string;
  /** Local open hour (in the session's timezone) */
  localOpenHour: number;
  localOpenMin: number;
  /** How many minutes the scan window stays open */
  scanWindowMin: number;
  /** Local hour to force-close any open position */
  localCloseHour: number;
  /** IANA timezone for DST-aware conversion */
  timezone: string;
}

const SESSIONS: Session[] = [
  {
    name: "London",
    localOpenHour: 8,
    localOpenMin: 0,
    scanWindowMin: 15,
    localCloseHour: 12,
    timezone: "Europe/London",
  },
  {
    name: "New York",
    localOpenHour: 9,
    localOpenMin: 30,
    scanWindowMin: 15,
    localCloseHour: 13,
    timezone: "America/New_York",
  },
];

/**
 * Get the current local hour and minute for a timezone, handling DST.
 */
function getLocalTime(timestamp: number, timezone: string): { hour: number; min: number } {
  const date = new Date(timestamp);
  // Use Intl to get DST-aware local time
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const min = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
  return { hour, min };
}

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
  sessionCloseHour: number;
  sessionTimezone: string;
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
  private cooldowns = new Map<string, number>(); // instrument → timestamp when cooldown expires
  private tickCount = 0;
  private currentTimestamp = 0;

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
    this.tickCount++;
    this.currentTimestamp = tick.timestamp;

    const date = new Date(tick.timestamp);
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

    // Check if we're in a session scan window (DST-aware)
    for (const session of SESSIONS) {
      const local = getLocalTime(tick.timestamp, session.timezone);
      const openMinOfDay = session.localOpenHour * 60 + session.localOpenMin;
      const currentMinOfDay = local.hour * 60 + local.min;
      const inScanWindow =
        currentMinOfDay >= openMinOfDay &&
        currentMinOfDay < openMinOfDay + session.scanWindowMin;

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
      score: number;
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

      // Skip if on cooldown
      const cooldownExpiry = this.cooldowns.get(info.cross) ?? 0;
      if (this.currentTimestamp < cooldownExpiry) continue;

      if (Math.abs(deviation) >= this.config.minDeviationPct) {
        // Score by deviation relative to spread cost — prefer high deviation, low spread
        const spreadCost = this.config.spreads?.[info.cross] ?? 0.0002;
        const spreadPct = (spreadCost / crossPrice) * 100;
        const score = Math.abs(deviation) / spreadPct; // deviation-to-spread ratio

        candidates.push({
          info,
          deviation,
          implied,
          actual: crossPrice,
          legAPrice,
          legBPrice,
          score,
        });
      }
    }

    if (candidates.length === 0) return;

    // Pick the best risk/reward: highest deviation-to-spread ratio
    candidates.sort((a, b) => b.score - a.score);
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
      sessionCloseHour: session.localCloseHour,
      sessionTimezone: session.timezone,
    };
  }

  private async checkExit(ctx: StrategyContext, tick: Tick): Promise<void> {
    const pos = this.position!;
    const currentPrice = this.prices.get(pos.instrument);
    if (!currentPrice) return;

    const local = getLocalTime(tick.timestamp, pos.sessionTimezone);

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

    const elapsed = tick.timestamp - pos.entryTimestamp;
    const minHoldMs = (this.config.minHold ?? 0) * 60_000; // config is in M1 candles = minutes
    const maxHoldMs = this.config.maxHold * 60_000;

    // Hard exits always apply (stop loss, max hold, session end)
    const hardExit =
      pnl <= -pos.stopLoss ||
      elapsed >= maxHoldMs ||
      local.hour >= pos.sessionCloseHour;

    // Soft exits only after minimum hold period
    const pastMinHold = elapsed >= minHoldMs;

    const reversionAchieved =
      Math.abs(pos.entryDeviation) > 0 &&
      Math.abs(currentDeviation) <=
        Math.abs(pos.entryDeviation) * (1 - this.config.reversionTarget);

    const shouldExit =
      hardExit ||
      (pastMinHold && pnl >= pos.takeProfit) ||
      (pastMinHold && reversionAchieved);

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
    const cooldownMs = this.config.cooldownPeriod * 60_000; // config in M1 candles = minutes
    this.cooldowns.set(pos.instrument, this.currentTimestamp + cooldownMs);
    this.position = null;
  }

  async dispose(): Promise<void> {
    this.crossInfos = [];
    this.prices.clear();
    this.position = null;
    this.cooldowns.clear();
  }
}
