/**
 * RecordingBroker — a decorator that wraps any Broker and records all
 * order submissions and position closes with their actual results.
 *
 * Replaces the position-diffing approach with direct interception of
 * broker calls. Captures OANDA's actual fill prices and realized P&L.
 * Also records failed calls for debugging.
 */

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

export interface TradeRecord {
  strategy: string;
  instrument: string;
  side: "buy" | "sell";
  units: number;
  entryTime: string;
  entryPrice: number;
  entryOrderId: string;
  exitTime?: string;
  exitPrice?: number;
  exitOrderId?: string;
  pnl?: number;
  durationMs?: number;
}

export interface EntryRecord {
  strategy: string;
  instrument: string;
  side: "buy" | "sell";
  units: number;
  entryTime: string;
  entryPrice: number;
  entryOrderId: string;
}

export interface FailedCall {
  timestamp: string;
  method: "submitOrder" | "closePosition";
  instrument: string;
  error: string;
  request?: OrderRequest;
}

export class RecordingBroker implements Broker {
  readonly name: string;
  private inner: Broker;
  private strategyName: string;
  private openTrades = new Map<string, EntryRecord>();
  private completedTrades: TradeRecord[] = [];
  private newEntries: EntryRecord[] = [];
  private failures: FailedCall[] = [];

  constructor(inner: Broker, strategyName: string) {
    this.inner = inner;
    this.name = inner.name;
    this.strategyName = strategyName;
  }

  /** Drain and return completed trades since last call */
  flushTrades(): TradeRecord[] {
    const trades = this.completedTrades;
    this.completedTrades = [];
    return trades;
  }

  /** Drain and return new entry records since last call */
  flushEntries(): EntryRecord[] {
    const entries = this.newEntries;
    this.newEntries = [];
    return entries;
  }

  /** Drain and return failed calls since last call */
  flushFailures(): FailedCall[] {
    const failures = this.failures;
    this.failures = [];
    return failures;
  }

  /** Get currently open trades (for status display) */
  getOpenTrades(): ReadonlyMap<string, EntryRecord> {
    return this.openTrades;
  }

  // --- Intercepted methods ---

  async submitOrder(order: OrderRequest): Promise<OrderResult> {
    try {
      const result = await this.inner.submitOrder(order);
      const entry: EntryRecord = {
        strategy: this.strategyName,
        instrument: result.instrument,
        side: result.side,
        units: result.units,
        entryTime: new Date(result.timestamp).toISOString(),
        entryPrice: result.filledPrice,
        entryOrderId: result.id,
      };
      this.openTrades.set(result.instrument, entry);
      this.newEntries.push(entry);
      return result;
    } catch (err) {
      this.failures.push({
        timestamp: new Date().toISOString(),
        method: "submitOrder",
        instrument: order.instrument,
        error: err instanceof Error ? err.message : String(err),
        request: order,
      });
      throw err;
    }
  }

  async closePosition(instrument: Instrument): Promise<OrderResult> {
    try {
      const result = await this.inner.closePosition(instrument);
      const entry = this.openTrades.get(instrument);

      if (entry) {
        this.completedTrades.push({
          ...entry,
          exitTime: new Date(result.timestamp).toISOString(),
          exitPrice: result.filledPrice,
          exitOrderId: result.id,
          pnl: result.realizedPL,
          durationMs: result.timestamp - new Date(entry.entryTime).getTime(),
        });
        this.openTrades.delete(instrument);
      } else {
        // Unmatched close (position existed before recording started)
        this.completedTrades.push({
          strategy: this.strategyName,
          instrument: result.instrument,
          side: result.side === "buy" ? "sell" : "buy",
          units: result.units,
          entryTime: "unknown",
          entryPrice: 0,
          entryOrderId: "unknown",
          exitTime: new Date(result.timestamp).toISOString(),
          exitPrice: result.filledPrice,
          exitOrderId: result.id,
          pnl: result.realizedPL,
        });
      }

      return result;
    } catch (err) {
      this.failures.push({
        timestamp: new Date().toISOString(),
        method: "closePosition",
        instrument,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // --- Pure delegation ---

  getAccountSummary(): Promise<AccountSummary> {
    return this.inner.getAccountSummary();
  }

  getPositions(): Promise<Position[]> {
    return this.inner.getPositions();
  }

  getCandles(instrument: Instrument, granularity: Granularity, count: number): Promise<Candle[]> {
    return this.inner.getCandles(instrument, granularity, count);
  }

  getCandlesByRange(instrument: Instrument, granularity: Granularity, from: Date, to: Date): Promise<Candle[]> {
    return this.inner.getCandlesByRange(instrument, granularity, from, to);
  }

  getPrice(instrument: Instrument): Promise<Tick> {
    return this.inner.getPrice(instrument);
  }

  streamPrices(instruments: Instrument[], onTick: (tick: Tick) => void): Promise<{ close: () => void }> {
    return this.inner.streamPrices(instruments, onTick);
  }
}
