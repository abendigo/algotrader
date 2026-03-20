import type { Granularity, Instrument } from "../core/types.js";

/** Configuration for a backtest run */
export interface BacktestConfig {
  /** Which granularity data to replay */
  granularity: Granularity;
  /** Starting balance in account currency */
  initialBalance: number;
  /** Simulated spread — either a flat number or per-instrument map (absolute price units) */
  spread: number | Record<string, number>;
  /** Instruments to load (defaults to all if not set) */
  instruments?: Instrument[];
  /** Start date filter "YYYY-MM-DD" inclusive (optional) */
  fromDate?: string;
  /** End date filter "YYYY-MM-DD" inclusive (optional) */
  toDate?: string;
  /** Multiply all spreads by this factor (default: 1.0). Use 2.0 to stress-test wider spreads */
  spreadMultiplier?: number;
  /** Delay order execution by this many ticks on the same instrument (default: 0) */
  executionDelay?: number;
  /** Use time-varying spread model (wider at session open, tighter during overlap) */
  timeVaryingSpread?: boolean;
  /** Random slippage in pips added to each fill (default: 0). Simulates execution quality. */
  slippagePips?: number;
  /** Account currency for P&L conversion (default: "USD") */
  accountCurrency?: string;
  /** Financing rates per instrument: { longRate, shortRate } (annual, as decimals) */
  financingRates?: Record<string, { longRate: number; shortRate: number }>;
}

/** Signal snapshot captured at entry or exit */
export interface SignalSnapshot {
  zScore: number;
  deviation: number;
  deviationMean: number;
  deviationStd: number;
  impliedRate: number;
  actualRate: number;
  legA: string;
  legAPrice: number;
  legB: string;
  legBPrice: number;
}

/** Currency conversion details for P&L audit trail */
export interface PnlConversion {
  /** P&L in the quote currency of the traded pair */
  pnlQuote: number;
  /** Quote currency of the pair (e.g., "USD", "JPY") */
  quoteCurrency: string;
  /** Account currency (e.g., "CAD") */
  accountCurrency: string;
  /** Conversion rate used (quote → account) */
  conversionRate: number;
  /** Which pair provided the conversion rate (e.g., "USD_CAD") */
  conversionPair: string;
}

/** A single completed trade (open → close) */
export interface Trade {
  instrument: Instrument;
  side: "buy" | "sell";
  units: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  /** P&L in account currency */
  pnl: number;
  /** Conversion details for audit trail */
  conversion?: PnlConversion;
  entrySignal?: SignalSnapshot;
  exitSignal?: SignalSnapshot;
}

/** Summary statistics from a backtest */
export interface BacktestResult {
  config: BacktestConfig;
  startTime: number;
  endTime: number;
  totalTicks: number;
  initialBalance: number;
  finalBalance: number;
  totalPnL: number;
  returnPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  trades: Trade[];
  /** Equity curve: array of [timestamp, equity] */
  equityCurve: [number, number][];
}
