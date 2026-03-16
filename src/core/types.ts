/** A currency pair like "EUR_USD" (OANDA format uses underscore) */
export type Instrument = string;

/** OHLCV candle */
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A price tick with bid/ask */
export interface Tick {
  instrument: Instrument;
  timestamp: number;
  bid: number;
  ask: number;
}

/** Order side */
export type Side = "buy" | "sell";

/** Order types */
export type OrderType = "market" | "limit" | "stop";

/** Order request sent to a broker */
export interface OrderRequest {
  instrument: Instrument;
  side: Side;
  type: OrderType;
  units: number;
  price?: number; // required for limit/stop
}

/** Order response from broker */
export interface OrderResult {
  id: string;
  instrument: Instrument;
  side: Side;
  units: number;
  filledPrice: number;
  timestamp: number;
}

/** Current open position */
export interface Position {
  instrument: Instrument;
  side: Side;
  units: number;
  averagePrice: number;
  unrealizedPL: number;
}

/** Account state */
export interface AccountSummary {
  balance: number;
  unrealizedPL: number;
  currency: string;
  openPositions: number;
}

/** Candle granularity */
export type Granularity =
  | "S5"
  | "S10"
  | "S15"
  | "S30"
  | "M1"
  | "M2"
  | "M4"
  | "M5"
  | "M10"
  | "M15"
  | "M30"
  | "H1"
  | "H2"
  | "H3"
  | "H4"
  | "H6"
  | "H8"
  | "H12"
  | "D"
  | "W"
  | "M";
