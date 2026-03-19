/**
 * Generic test result shape — produced by both backtests and paper trading.
 * Export functions (HTML, CSV) consume this interface.
 */

export interface TestTrade {
  instrument: string;
  side: "buy" | "sell";
  units: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  pnl: number;
}

export interface TestResult {
  /** "backtest" | "paper" | "live" */
  source: string;
  strategyName: string;
  startTime: number;
  endTime: number;
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
  trades: TestTrade[];
  equityCurve: [number, number][];
}

/** Compute summary stats from a list of trades and an initial balance */
export function computeStats(
  trades: TestTrade[],
  initialBalance: number,
): Omit<TestResult, "source" | "strategyName" | "trades" | "startTime" | "endTime"> {
  const winners = trades.filter((t) => t.pnl > 0);
  const losers = trades.filter((t) => t.pnl < 0);
  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const finalBalance = initialBalance + totalPnL;
  const returnPct = initialBalance > 0 ? (totalPnL / initialBalance) * 100 : 0;
  const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? Math.abs(losers.reduce((s, t) => s + t.pnl, 0) / losers.length) : 0;
  const grossWins = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // Equity curve and drawdown
  let equity = initialBalance;
  let peak = initialBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const equityCurve: [number, number][] = [[trades[0]?.entryTime ?? 0, initialBalance]];

  for (const t of trades) {
    equity += t.pnl;
    equityCurve.push([t.exitTime, equity]);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  // Sharpe ratio (daily returns approximation)
  const dailyPnls = new Map<string, number>();
  for (const t of trades) {
    const day = new Date(t.exitTime).toISOString().slice(0, 10);
    dailyPnls.set(day, (dailyPnls.get(day) ?? 0) + t.pnl);
  }
  const returns = [...dailyPnls.values()];
  const meanReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdReturn = Math.sqrt(variance);
  const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : 0;

  return {
    initialBalance,
    finalBalance,
    totalPnL,
    returnPct,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    totalTrades: trades.length,
    winRate: trades.length > 0 ? winners.length / trades.length : 0,
    avgWin,
    avgLoss,
    profitFactor,
    equityCurve,
  };
}
