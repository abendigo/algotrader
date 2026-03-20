import type { Broker } from "../core/broker.js";
import type {
  AccountSummary,
  Candle,
  Granularity,
  Instrument,
  OrderRequest,
  OrderResult,
  Position,
  Tick,
} from "../core/types.js";
import type { SignalSnapshot, Trade, PnlConversion } from "./types.js";
import { getSpreadMultiplier } from "./spread-model.js";

interface InternalPosition {
  instrument: Instrument;
  side: "buy" | "sell";
  units: number;
  averagePrice: number;
  entryTime: number;
  entrySignal?: SignalSnapshot;
}

/**
 * Simulated broker for backtesting.
 * Fills market orders at the current tick price ± half spread.
 * Tracks positions, balance, and completed trades.
 */
export class BacktestBroker implements Broker {
  readonly name = "backtest";

  private balance: number;
  private positions = new Map<Instrument, InternalPosition>();
  private currentTick = new Map<Instrument, Tick>();
  private tradeLog: Trade[] = [];
  private orderCounter = 0;
  private spread: number | Record<string, number>;
  private spreadMultiplier: number;
  private useTimeVaryingSpread: boolean;
  private slippagePips: number;
  private accountCurrency: string;
  private pendingEntrySignal?: SignalSnapshot;
  private pendingExitSignal?: SignalSnapshot;
  /** Annual financing rates per instrument: { longRate, shortRate } */
  private financingRates = new Map<string, { longRate: number; shortRate: number }>();
  /** Last date financing was applied per instrument (to apply once per day) */
  private lastFinancingDate = new Map<string, string>();
  /** Total financing earned/paid */
  private totalFinancing = 0;

  constructor(
    initialBalance: number,
    spread: number | Record<string, number>,
    spreadMultiplier: number = 1.0,
    useTimeVaryingSpread: boolean = false,
    slippagePips: number = 0,
    accountCurrency: string = "USD",
  ) {
    this.balance = initialBalance;
    this.spread = spread;
    this.spreadMultiplier = spreadMultiplier;
    this.useTimeVaryingSpread = useTimeVaryingSpread;
    this.slippagePips = slippagePips;
    this.accountCurrency = accountCurrency;
  }

  /** Apply random slippage against the trader (always adverse) */
  private applySlippage(price: number, side: "buy" | "sell", instrument: Instrument): number {
    if (this.slippagePips === 0) return price;
    const pipSize = instrument.includes("JPY") ? 0.01 : 0.0001;
    const slip = Math.random() * this.slippagePips * pipSize;
    return side === "buy" ? price + slip : price - slip;
  }

  private getSpread(instrument: Instrument): number {
    const base = typeof this.spread === "number"
      ? this.spread
      : (this.spread[instrument] ?? 0.0002);

    let multiplier = this.spreadMultiplier;
    if (this.useTimeVaryingSpread) {
      const tick = this.currentTick.get(instrument);
      if (tick) {
        multiplier *= getSpreadMultiplier(tick.timestamp);
      }
    }
    return base * multiplier;
  }

  /** Attach a signal snapshot to the next order (entry) */
  setEntrySignal(signal: SignalSnapshot): void {
    this.pendingEntrySignal = signal;
  }

  /** Attach a signal snapshot to the next close (exit) */
  setExitSignal(signal: SignalSnapshot): void {
    this.pendingExitSignal = signal;
  }

  /** Set financing rates for instruments (annual rates as decimals, e.g., 0.05 = 5%) */
  setFinancingRates(rates: Map<string, { longRate: number; shortRate: number }>): void {
    this.financingRates = rates;
  }

  /** Get total financing earned/paid */
  getTotalFinancing(): number {
    return this.totalFinancing;
  }

  /** Called by the engine on each tick to update prices */
  setTick(tick: Tick): void {
    this.currentTick.set(tick.instrument, tick);
    // Apply daily financing to open positions at day boundary
    this.applyFinancing(tick);
  }

  /** Apply daily financing to an open position if we've crossed a day boundary */
  private applyFinancing(tick: Tick): void {
    const pos = this.positions.get(tick.instrument);
    if (!pos) return;

    const rates = this.financingRates.get(tick.instrument);
    if (!rates) return;

    const dateStr = new Date(tick.timestamp).toISOString().slice(0, 10);
    const lastDate = this.lastFinancingDate.get(tick.instrument);
    if (lastDate === dateStr) return; // already applied today
    if (!lastDate) {
      // First tick for this position today — just record the date
      this.lastFinancingDate.set(tick.instrument, dateStr);
      return;
    }

    this.lastFinancingDate.set(tick.instrument, dateStr);

    // Calculate financing: position_value × daily_rate
    // Rate is annual, divide by 365 for daily
    const annualRate = pos.side === "buy" ? rates.longRate : rates.shortRate;
    const dailyRate = annualRate / 365;
    const mid = (tick.bid + tick.ask) / 2;
    const positionValue = mid * pos.units;
    const financingInQuote = positionValue * dailyRate;

    // Convert to account currency
    const { pnl: financingInAccount } = this.convertToAccountCurrency(financingInQuote, tick.instrument);

    this.balance += financingInAccount;
    this.totalFinancing += financingInAccount;
  }

  /** Get all completed trades */
  getTrades(): Trade[] {
    return this.tradeLog;
  }

  /** Get current balance (realized only) */
  getBalance(): number {
    return this.balance;
  }

  /** Get current equity (balance + unrealized PnL) */
  getEquity(): number {
    let unrealized = 0;
    for (const pos of this.positions.values()) {
      unrealized += this.computeUnrealizedPnL(pos);
    }
    return this.balance + unrealized;
  }

  // --- Broker interface ---

  async getAccountSummary(): Promise<AccountSummary> {
    let unrealizedPL = 0;
    for (const pos of this.positions.values()) {
      unrealizedPL += this.computeUnrealizedPnL(pos);
    }
    return {
      balance: this.balance,
      unrealizedPL,
      currency: "USD",
      openPositions: this.positions.size,
      hedgingEnabled: false,
    };
  }

  async getPositions(): Promise<Position[]> {
    return Array.from(this.positions.values()).map((pos) => ({
      instrument: pos.instrument,
      side: pos.side,
      units: pos.units,
      averagePrice: pos.averagePrice,
      unrealizedPL: this.computeUnrealizedPnL(pos),
    }));
  }

  async submitOrder(order: OrderRequest): Promise<OrderResult> {
    if (order.type !== "market") {
      throw new Error("Backtest broker only supports market orders");
    }

    const tick = this.currentTick.get(order.instrument);
    if (!tick) {
      throw new Error(`No price data for ${order.instrument}`);
    }

    // Apply spread: buy at ask (mid + half spread), sell at bid (mid - half spread)
    const mid = (tick.bid + tick.ask) / 2;
    const halfSpread = this.getSpread(order.instrument) / 2;
    const rawFill =
      order.side === "buy"
        ? mid + halfSpread
        : mid - halfSpread;
    const fillPrice = this.applySlippage(rawFill, order.side, order.instrument);

    const existing = this.positions.get(order.instrument);

    const entrySignal = this.pendingEntrySignal;
    this.pendingEntrySignal = undefined;

    // If there's an existing position in the opposite direction, close it first
    if (existing && existing.side !== order.side) {
      this.closePositionInternal(existing, fillPrice, tick.timestamp);

      const remaining = order.units - existing.units;
      if (remaining > 0) {
        // Open a new position with the leftover units
        this.positions.set(order.instrument, {
          instrument: order.instrument,
          side: order.side,
          units: remaining,
          averagePrice: fillPrice,
          entryTime: tick.timestamp,
          entrySignal,
        });
      }
    } else if (existing && existing.side === order.side) {
      // Average into the position
      const totalUnits = existing.units + order.units;
      existing.averagePrice =
        (existing.averagePrice * existing.units + fillPrice * order.units) /
        totalUnits;
      existing.units = totalUnits;
    } else {
      // New position
      this.positions.set(order.instrument, {
        instrument: order.instrument,
        side: order.side,
        units: order.units,
        averagePrice: fillPrice,
        entryTime: tick.timestamp,
        entrySignal,
      });
    }

    return {
      id: String(++this.orderCounter),
      instrument: order.instrument,
      side: order.side,
      units: order.units,
      filledPrice: fillPrice,
      timestamp: tick.timestamp,
    };
  }

  async closePosition(instrument: Instrument): Promise<OrderResult> {
    const pos = this.positions.get(instrument);
    if (!pos) {
      throw new Error(`No open position for ${instrument}`);
    }

    const tick = this.currentTick.get(instrument);
    if (!tick) {
      throw new Error(`No price data for ${instrument}`);
    }

    const mid = (tick.bid + tick.ask) / 2;
    // Close a buy at bid, close a sell at ask
    const halfSpread = this.getSpread(instrument) / 2;
    // Close: buy → sell at bid, sell → buy at ask. Slippage is adverse to the closer.
    const closeSide = pos.side === "buy" ? "sell" : "buy";
    const rawFill =
      pos.side === "buy"
        ? mid - halfSpread
        : mid + halfSpread;
    const fillPrice = this.applySlippage(rawFill, closeSide, instrument);

    this.closePositionInternal(pos, fillPrice, tick.timestamp);

    return {
      id: String(++this.orderCounter),
      instrument,
      side: closeSide,
      units: pos.units,
      filledPrice: fillPrice,
      timestamp: tick.timestamp,
    };
  }

  // Market data methods — not meaningful in backtest but required by interface
  async getCandles(
    _instrument: Instrument,
    _granularity: Granularity,
    _count: number,
  ): Promise<Candle[]> {
    return [];
  }

  async getCandlesByRange(
    _instrument: Instrument,
    _granularity: Granularity,
    _from: Date,
    _to: Date,
  ): Promise<Candle[]> {
    return [];
  }

  async getPrice(instrument: Instrument): Promise<Tick> {
    const tick = this.currentTick.get(instrument);
    if (!tick) throw new Error(`No price data for ${instrument}`);
    return tick;
  }

  async streamPrices(
    _instruments: Instrument[],
    _onTick: (tick: Tick) => void,
  ): Promise<{ close: () => void }> {
    throw new Error("streamPrices not supported in backtest");
  }

  // --- Internal helpers ---

  /**
   * Convert a P&L amount from the quote currency of an instrument to the
   * account currency. Returns the converted value and an audit trail.
   */
  private convertToAccountCurrency(pnlInQuote: number, instrument: Instrument): { pnl: number; conversion: PnlConversion } {
    const [, quote] = instrument.split("_");
    const acct = this.accountCurrency;

    const makeResult = (pnl: number, rate: number, pair: string): { pnl: number; conversion: PnlConversion } => ({
      pnl,
      conversion: { pnlQuote: pnlInQuote, quoteCurrency: quote, accountCurrency: acct, conversionRate: rate, conversionPair: pair },
    });

    if (quote === acct) return makeResult(pnlInQuote, 1, "none");

    // Try {ACCT}_{QUOTE} — divide by rate
    const acctQuoteTick = this.currentTick.get(`${acct}_${quote}` as Instrument);
    if (acctQuoteTick) {
      const rate = (acctQuoteTick.bid + acctQuoteTick.ask) / 2;
      if (rate > 0) return makeResult(pnlInQuote / rate, 1 / rate, `${acct}_${quote}`);
    }

    // Try {QUOTE}_{ACCT} — multiply by rate
    const quoteAcctTick = this.currentTick.get(`${quote}_${acct}` as Instrument);
    if (quoteAcctTick) {
      const rate = (quoteAcctTick.bid + quoteAcctTick.ask) / 2;
      return makeResult(pnlInQuote * rate, rate, `${quote}_${acct}`);
    }

    // Fallback: two-hop via USD
    let pnlInUsd = pnlInQuote;
    let hop1Pair = "none";
    let hop1Rate = 1;
    if (quote !== "USD") {
      const usdQuoteTick = this.currentTick.get(`USD_${quote}` as Instrument);
      if (usdQuoteTick) {
        hop1Rate = 1 / ((usdQuoteTick.bid + usdQuoteTick.ask) / 2);
        pnlInUsd = pnlInQuote * hop1Rate;
        hop1Pair = `USD_${quote}`;
      } else {
        const quoteUsdTick = this.currentTick.get(`${quote}_USD` as Instrument);
        if (quoteUsdTick) {
          hop1Rate = (quoteUsdTick.bid + quoteUsdTick.ask) / 2;
          pnlInUsd = pnlInQuote * hop1Rate;
          hop1Pair = `${quote}_USD`;
        } else {
          return makeResult(pnlInQuote, 1, "no-conversion-data");
        }
      }
    }
    if (acct === "USD") return makeResult(pnlInUsd, hop1Rate, hop1Pair);

    // USD → account currency
    const acctUsdTick = this.currentTick.get(`${acct}_USD` as Instrument);
    if (acctUsdTick) {
      const hop2Rate = 1 / ((acctUsdTick.bid + acctUsdTick.ask) / 2);
      const totalRate = hop1Rate * hop2Rate;
      return makeResult(pnlInQuote * totalRate, totalRate, `${hop1Pair}+${acct}_USD`);
    }
    const usdAcctTick = this.currentTick.get(`USD_${acct}` as Instrument);
    if (usdAcctTick) {
      const hop2Rate = (usdAcctTick.bid + usdAcctTick.ask) / 2;
      const totalRate = hop1Rate * hop2Rate;
      return makeResult(pnlInQuote * totalRate, totalRate, `${hop1Pair}+USD_${acct}`);
    }

    return makeResult(pnlInUsd, hop1Rate, `${hop1Pair}+no-acct-pair`);
  }

  private computeUnrealizedPnL(pos: InternalPosition): number {
    const tick = this.currentTick.get(pos.instrument);
    if (!tick) return 0;
    const mid = (tick.bid + tick.ask) / 2;
    const diff =
      pos.side === "buy" ? mid - pos.averagePrice : pos.averagePrice - mid;
    const pnlInQuote = diff * pos.units;
    return this.convertToAccountCurrency(pnlInQuote, pos.instrument).pnl;
  }

  private closePositionInternal(
    pos: InternalPosition,
    exitPrice: number,
    exitTime: number,
  ): void {
    const diff =
      pos.side === "buy"
        ? exitPrice - pos.averagePrice
        : pos.averagePrice - exitPrice;
    const pnlInQuote = diff * pos.units;
    const { pnl, conversion } = this.convertToAccountCurrency(pnlInQuote, pos.instrument);

    const exitSignal = this.pendingExitSignal;
    this.pendingExitSignal = undefined;

    this.balance += pnl;
    this.tradeLog.push({
      instrument: pos.instrument,
      side: pos.side,
      units: pos.units,
      entryPrice: pos.averagePrice,
      exitPrice,
      entryTime: pos.entryTime,
      exitTime,
      pnl,
      conversion,
      entrySignal: pos.entrySignal,
      exitSignal,
    });
    this.positions.delete(pos.instrument);
  }
}
