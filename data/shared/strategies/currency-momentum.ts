/**
 * Currency Strength Momentum Strategy
 *
 * Tracks the momentum of each of the 8 currencies (EUR, GBP, USD, JPY,
 * CAD, CHF, AUD, NZD) by measuring their rate-of-change across all
 * USD-paired majors.
 *
 * Signal:
 *   1. For each currency, compute a strength score = % change of its
 *      USD pair over a rolling window.
 *   2. Rank currencies from strongest to weakest.
 *   3. Go long the cross pairing strongest vs weakest (e.g., long EUR_NZD
 *      if EUR is strongest and NZD is weakest).
 *   4. Hold until the ranking changes or maxHold is reached.
 *
 * Edge: currency momentum tends to persist over hours (central bank flows,
 * macro sentiment shifts, carry trades). By always being in the highest-
 * conviction pair, we maximize exposure to the strongest trend.
 *
 * Risk: only one position at a time. TP/SL based on spread multiples.
 */

import type { Strategy, StrategyContext, StrategyStateSnapshot } from "#core/strategy.js";
import type { Instrument, Tick } from "#core/types.js";
import type { SignalSnapshot } from "#backtest/types.js";
import { BacktestBroker } from "#backtest/broker.js";
import {
  CURRENCIES,
  USD_MAJORS,
  parsePair,
  findInstrument,
  type Currency,
} from "#data/instruments.js";

export interface CurrencyMomentumConfig {
  /** Rolling window for momentum calculation (default: 60) */
  momentumLookback: number;
  /** Minimum momentum spread between strongest and weakest to trade (default: 0.05%) */
  minSpread: number;
  /** Max candles to hold a position (default: 120) */
  maxHold: number;
  /** Take profit as multiple of instrument spread (default: 4.0) */
  takeProfitMultiple: number;
  /** Stop loss as multiple of instrument spread (default: 2.0) */
  stopLossMultiple: number;
  /** Units per trade (default: 10000) */
  units: number;
  /** Per-instrument spread for TP/SL calculation */
  spreads?: Record<string, number>;
}

export const strategyMeta = {
  name: "Currency Strength Momentum",
  description: "Ranks all 8 major currencies by momentum, then goes long the cross pairing strongest vs weakest. Pure relative-strength approach.",
  configFields: {
    common: {
      momentumLookback: { label: "Momentum lookback (candles)", type: "number" as const, default: 60, min: 1 },
      maxHold: { label: "Max hold (candles)", type: "number" as const, default: 120, min: 1 },
    },
    backtest: {},
    live: {
      units: { label: "Units", type: "number" as const, default: 10000, min: 1 },
    },
  },
};

const DEFAULT_CONFIG: CurrencyMomentumConfig = {
  momentumLookback: 60,
  minSpread: 0.05,
  maxHold: 120,
  takeProfitMultiple: 4.0,
  stopLossMultiple: 2.0,
  units: 10_000,
};

interface CurrencyState {
  /** Price history of this currency's USD pair */
  priceHistory: number[];
  /** Current momentum: % change over lookback */
  momentum: number;
}

interface OpenPosition {
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  entryTick: number;
  takeProfit: number;
  stopLoss: number;
  strongCcy: Currency;
  weakCcy: Currency;
}

export class CurrencyMomentumStrategy implements Strategy {
  readonly name = "currency-momentum";
  readonly hedging = "forbidden" as const;

  private config: CurrencyMomentumConfig;
  private prices = new Map<Instrument, number>();
  private currencyStates = new Map<Currency, CurrencyState>();
  private position: OpenPosition | null = null;
  private tickCount = 0;
  private lastEvalTimestamp = 0;

  constructor(config?: Partial<CurrencyMomentumConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(_ctx: StrategyContext): Promise<void> {
    for (const ccy of CURRENCIES) {
      this.currencyStates.set(ccy, {
        priceHistory: [],
        momentum: 0,
      });
    }
  }

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    this.prices.set(tick.instrument, (tick.bid + tick.ask) / 2);
    this.tickCount++;

    // Only evaluate on USD major ticks (these drive the signal)
    if (!(USD_MAJORS as readonly string[]).includes(tick.instrument)) return;

    // Don't evaluate multiple times per timestamp
    if (tick.timestamp === this.lastEvalTimestamp) return;
    this.lastEvalTimestamp = tick.timestamp;

    // Update currency price histories
    // We need all 7 USD majors to have prices
    let allReady = true;
    for (const pair of USD_MAJORS) {
      const price = this.prices.get(pair);
      if (!price) { allReady = false; break; }
    }
    if (!allReady) return;

    // Update each currency's price from its USD pair
    for (const pair of USD_MAJORS) {
      const [base, quote] = parsePair(pair);
      const price = this.prices.get(pair)!;

      // For XXX_USD pairs: price going up = XXX strengthening
      // For USD_XXX pairs: price going up = XXX weakening (USD strengthening)
      const ccy = base === "USD" ? quote : base;
      const strength = base === "USD" ? -price : price; // normalize so up = ccy strengthening

      const state = this.currencyStates.get(ccy as Currency)!;
      state.priceHistory.push(strength);
      if (state.priceHistory.length > this.config.momentumLookback + 1) {
        state.priceHistory.shift();
      }
    }

    // Also track USD strength (inverse of average of all others, or use DXY-like approach)
    // Simple: USD strength = average of all USD_XXX prices (inverted for XXX_USD)
    const usdPrices: number[] = [];
    for (const pair of USD_MAJORS) {
      const [base] = parsePair(pair);
      const price = this.prices.get(pair)!;
      usdPrices.push(base === "USD" ? price : 1 / price);
    }
    const usdStrength = usdPrices.reduce((a, b) => a + b, 0) / usdPrices.length;
    const usdState = this.currencyStates.get("USD" as Currency)!;
    usdState.priceHistory.push(usdStrength);
    if (usdState.priceHistory.length > this.config.momentumLookback + 1) {
      usdState.priceHistory.shift();
    }

    // Need full lookback window
    const ready = [...this.currencyStates.values()].every(
      (s) => s.priceHistory.length > this.config.momentumLookback,
    );
    if (!ready) return;

    // Compute momentum for each currency
    const rankings: { ccy: Currency; momentum: number }[] = [];
    for (const [ccy, state] of this.currencyStates) {
      const current = state.priceHistory[state.priceHistory.length - 1];
      const past = state.priceHistory[state.priceHistory.length - 1 - this.config.momentumLookback];
      const momentum = ((current - past) / Math.abs(past)) * 100;
      state.momentum = momentum;
      rankings.push({ ccy, momentum });
    }

    rankings.sort((a, b) => b.momentum - a.momentum);
    const strongest = rankings[0];
    const weakest = rankings[rankings.length - 1];
    const momentumSpread = strongest.momentum - weakest.momentum;

    // Check exit for existing position
    if (this.position) {
      const pos = this.position;
      const currentPrice = this.prices.get(pos.instrument);
      if (!currentPrice) return;

      const ticksHeld = this.tickCount - pos.entryTick;
      const currentPnL =
        pos.side === "buy"
          ? currentPrice - pos.entryPrice
          : pos.entryPrice - currentPrice;

      // Exit conditions: TP, SL, max hold, or ranking shift
      const rankingShifted =
        pos.strongCcy !== strongest.ccy || pos.weakCcy !== weakest.ccy;

      const shouldExit =
        ticksHeld >= this.config.maxHold ||
        currentPnL >= pos.takeProfit ||
        currentPnL <= -pos.stopLoss ||
        (rankingShifted && ticksHeld > 10); // give it at least 10 ticks

      if (shouldExit) {
        if (ctx.broker instanceof BacktestBroker) {
          ctx.broker.setExitSignal(this.buildSignal(strongest, weakest, pos.instrument));
        }
        await ctx.broker.closePosition(pos.instrument);
        this.position = null;
      }

      // If we still have a position, don't enter a new one
      if (this.position) return;
    }

    // Entry: need sufficient momentum spread
    if (momentumSpread < this.config.minSpread) return;

    // Find the cross pair between strongest and weakest
    const instrument = findInstrument(strongest.ccy, weakest.ccy);
    if (!instrument) return;

    // Determine side: we want long strongest, short weakest
    const [base] = parsePair(instrument);
    const side: "buy" | "sell" = base === strongest.ccy ? "buy" : "sell";

    const currentPrice = this.prices.get(instrument);
    if (!currentPrice) return;

    // TP/SL based on spread
    const spreadCost = this.config.spreads?.[instrument] ?? 0.0002;
    const takeProfit = spreadCost * this.config.takeProfitMultiple;
    const stopLoss = spreadCost * this.config.stopLossMultiple;

    if (ctx.broker instanceof BacktestBroker) {
      ctx.broker.setEntrySignal(this.buildSignal(strongest, weakest, instrument));
    }

    await ctx.broker.submitOrder({
      instrument,
      side,
      type: "market",
      units: this.config.units,
    });

    this.position = {
      instrument,
      side,
      entryPrice: currentPrice,
      entryTick: this.tickCount,
      takeProfit,
      stopLoss,
      strongCcy: strongest.ccy,
      weakCcy: weakest.ccy,
    };
  }


  getState(): StrategyStateSnapshot {
    return {
      phase: "Running",
      indicators: [],
      positions: [],
    };
  }
  async dispose(): Promise<void> {
    this.currencyStates.clear();
    this.prices.clear();
    this.position = null;
  }

  private buildSignal(
    strongest: { ccy: Currency; momentum: number },
    weakest: { ccy: Currency; momentum: number },
    instrument: string,
  ): SignalSnapshot {
    const price = this.prices.get(instrument) ?? 0;
    return {
      zScore: strongest.momentum - weakest.momentum, // repurpose z-score as momentum spread
      deviation: strongest.momentum,
      deviationMean: weakest.momentum,
      deviationStd: 0,
      impliedRate: 0,
      actualRate: price,
      legA: `${strongest.ccy}(+${strongest.momentum.toFixed(3)}%)`,
      legAPrice: strongest.momentum,
      legB: `${weakest.ccy}(${weakest.momentum.toFixed(3)}%)`,
      legBPrice: weakest.momentum,
    };
  }
}
