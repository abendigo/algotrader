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

/** A single completed trade (open → close) */
export interface Trade {
  instrument: Instrument;
  side: "buy" | "sell";
  units: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  pnl: number;
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
