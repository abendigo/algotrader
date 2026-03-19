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
  /** Realized P&L from the broker (account currency). Only set on close. */
  realizedPL?: number;
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
  hedgingEnabled: boolean;
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

/** Seconds per candle for each granularity, ordered smallest to largest */
export const GRANULARITY_SECONDS: Record<Granularity, number> = {
  S5: 5, S10: 10, S15: 15, S30: 30,
  M1: 60, M2: 120, M4: 240, M5: 300,
  M10: 600, M15: 900, M30: 1800,
  H1: 3600, H2: 7200, H3: 10800, H4: 14400,
  H6: 21600, H8: 28800, H12: 43200,
  D: 86400, W: 604800, M: 2592000,
};

/** All granularities sorted chronologically (smallest to largest) */
export const GRANULARITIES_SORTED: Granularity[] = (
  Object.keys(GRANULARITY_SECONDS) as Granularity[]
).sort((a, b) => GRANULARITY_SECONDS[a] - GRANULARITY_SECONDS[b]);
