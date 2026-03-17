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
import type { SignalSnapshot, Trade } from "./types.js";
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
  private pendingEntrySignal?: SignalSnapshot;
  private pendingExitSignal?: SignalSnapshot;

  constructor(
    initialBalance: number,
    spread: number | Record<string, number>,
    spreadMultiplier: number = 1.0,
    useTimeVaryingSpread: boolean = false,
  ) {
    this.balance = initialBalance;
    this.spread = spread;
    this.spreadMultiplier = spreadMultiplier;
    this.useTimeVaryingSpread = useTimeVaryingSpread;
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

  /** Called by the engine on each tick to update prices */
  setTick(tick: Tick): void {
    this.currentTick.set(tick.instrument, tick);
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
    const fillPrice =
      order.side === "buy"
        ? mid + halfSpread
        : mid - halfSpread;

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
    const fillPrice =
      pos.side === "buy"
        ? mid - halfSpread
        : mid + halfSpread;

    this.closePositionInternal(pos, fillPrice, tick.timestamp);

    const closeSide = pos.side === "buy" ? "sell" : "buy";
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

  private computeUnrealizedPnL(pos: InternalPosition): number {
    const tick = this.currentTick.get(pos.instrument);
    if (!tick) return 0;
    const mid = (tick.bid + tick.ask) / 2;
    const diff =
      pos.side === "buy" ? mid - pos.averagePrice : pos.averagePrice - mid;
    return diff * pos.units;
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
    const pnl = diff * pos.units;

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
      entrySignal: pos.entrySignal,
      exitSignal,
    });
    this.positions.delete(pos.instrument);
  }
}
