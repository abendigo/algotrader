import type {
  AccountSummary,
  Candle,
  Granularity,
  Instrument,
  OrderRequest,
  OrderResult,
  Position,
  Tick,
} from "./types.js";

/** Abstract broker interface — implemented by OANDA, Tradovate, etc. */
export interface Broker {
  readonly name: string;

  // Account
  getAccountSummary(): Promise<AccountSummary>;
  getPositions(): Promise<Position[]>;

  // Orders
  submitOrder(order: OrderRequest): Promise<OrderResult>;
  closePosition(instrument: Instrument): Promise<OrderResult>;

  // Market data
  getCandles(
    instrument: Instrument,
    granularity: Granularity,
    count: number,
  ): Promise<Candle[]>;

  getCandlesByRange(
    instrument: Instrument,
    granularity: Granularity,
    from: Date,
    to: Date,
  ): Promise<Candle[]>;

  getPrice(instrument: Instrument): Promise<Tick>;

  // Streaming
  streamPrices(
    instruments: Instrument[],
    onTick: (tick: Tick) => void,
  ): Promise<{ close: () => void }>;
}
