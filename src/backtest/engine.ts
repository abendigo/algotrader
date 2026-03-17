import type { Instrument, Tick } from "../core/types.js";
import type { Strategy } from "../core/strategy.js";
import { loadCandles, discoverInstruments } from "../data/loader.js";
import { BacktestBroker } from "./broker.js";
import type { BacktestConfig, BacktestResult, Trade } from "./types.js";

/** Convert a candle to a synthetic tick (mid ± tiny spread for bid/ask) */
function candleToTick(instrument: Instrument, candle: { timestamp: number; close: number }): Tick {
  return {
    instrument,
    timestamp: candle.timestamp,
    bid: candle.close,
    ask: candle.close,
  };
}

/**
 * Run a backtest: load historical data, replay through a strategy, collect results.
 */
export async function runBacktest(
  strategy: Strategy,
  config: BacktestConfig,
): Promise<BacktestResult> {
  const {
    granularity,
    initialBalance,
    spread,
    instruments: requestedInstruments,
    fromDate,
    toDate,
    spreadMultiplier = 1.0,
    executionDelay = 0,
    timeVaryingSpread = false,
    slippagePips = 0,
  } = config;

  // Discover instruments from data directory if not specified
  const instruments = requestedInstruments ?? discoverInstruments(granularity);

  // Load all candles and merge into a unified timeline
  const timeline = buildTimeline(instruments, granularity, fromDate, toDate);

  if (timeline.length === 0) {
    throw new Error(
      `No data found for granularity ${granularity}. Run collect first.`,
    );
  }

  const broker = new BacktestBroker(initialBalance, spread, spreadMultiplier, timeVaryingSpread, slippagePips);
  const ctx = { broker };

  // Initialize strategy
  await strategy.init(ctx);

  // Replay
  // When executionDelay > 0, the strategy sees a delayed tick (simulating
  // signal detection latency) while the broker fills at the current price.
  // We buffer ticks per instrument and feed the strategy the tick from
  // N ticks ago on that instrument.
  const tickBuffers = new Map<Instrument, Tick[]>();
  const equityCurve: [number, number][] = [];
  let lastEquityTime = 0;

  for (const tick of timeline) {
    // Broker always sees current price (this is what fills execute at)
    broker.setTick(tick);

    // Determine which tick the strategy sees
    let strategyTick = tick;
    if (executionDelay > 0) {
      const buffer = tickBuffers.get(tick.instrument) ?? [];
      buffer.push(tick);
      tickBuffers.set(tick.instrument, buffer);

      if (buffer.length > executionDelay) {
        // Strategy sees the delayed tick
        strategyTick = buffer[buffer.length - 1 - executionDelay];
      } else {
        // Not enough history yet — strategy sees current (no delay applied)
        strategyTick = tick;
      }

      // Keep buffer bounded
      if (buffer.length > executionDelay + 10) {
        buffer.splice(0, buffer.length - executionDelay - 5);
      }
    }

    await strategy.onTick(ctx, strategyTick);

    // Sample equity curve once per unique timestamp
    if (tick.timestamp !== lastEquityTime) {
      equityCurve.push([tick.timestamp, broker.getEquity()]);
      lastEquityTime = tick.timestamp;
    }
  }

  // Dispose strategy
  await strategy.dispose();

  // Compute results
  const trades = broker.getTrades();
  const finalBalance = broker.getEquity();

  return {
    config,
    startTime: timeline[0].timestamp,
    endTime: timeline[timeline.length - 1].timestamp,
    totalTicks: timeline.length,
    initialBalance,
    finalBalance,
    totalPnL: finalBalance - initialBalance,
    returnPct: ((finalBalance - initialBalance) / initialBalance) * 100,
    ...computeMetrics(trades, equityCurve, initialBalance),
    trades,
    equityCurve,
  };
}

/**
 * Load candles for all instruments, convert to ticks, sort by timestamp.
 * When multiple instruments share a timestamp, they appear in sequence.
 */
function buildTimeline(
  instruments: Instrument[],
  granularity: string,
  fromDate?: string,
  toDate?: string,
): Tick[] {
  const ticks: Tick[] = [];

  for (const inst of instruments) {
    const candles = loadCandles(granularity, inst, fromDate, toDate);
    for (const candle of candles) {
      ticks.push(candleToTick(inst, candle));
    }
  }

  // Sort by timestamp, then by instrument for deterministic ordering
  ticks.sort(
    (a, b) => a.timestamp - b.timestamp || a.instrument.localeCompare(b.instrument),
  );

  return ticks;
}

function computeMetrics(
  trades: Trade[],
  equityCurve: [number, number][],
  initialBalance: number,
): {
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
} {
  // Max drawdown from equity curve
  let peak = initialBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  for (const [, equity] of equityCurve) {
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = (dd / peak) * 100;
    }
  }

  // Trade statistics
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
  const avgWin =
    wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0
      ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length
      : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

  // Sharpe ratio from per-period returns in the equity curve
  let sharpeRatio = 0;
  if (equityCurve.length > 1) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1][1];
      const curr = equityCurve[i][1];
      returns.push((curr - prev) / prev);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    // Annualize: assume M1 data = 525600 periods/year (rough)
    sharpeRatio = std > 0 ? (mean / std) * Math.sqrt(returns.length) : 0;
  }

  return {
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    totalTrades,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
  };
}

/** Pretty-print backtest results to console */
export function printResults(result: BacktestResult): void {
  const r = result;
  const startDate = new Date(r.startTime).toISOString().slice(0, 16);
  const endDate = new Date(r.endTime).toISOString().slice(0, 16);

  console.log(`\nBacktest Results`);
  console.log("=".repeat(50));
  console.log(`Period:          ${startDate} → ${endDate}`);
  console.log(`Ticks replayed:  ${r.totalTicks.toLocaleString()}`);
  console.log(`Initial balance: $${r.initialBalance.toFixed(2)}`);
  console.log(`Final balance:   $${r.finalBalance.toFixed(2)}`);
  console.log(`Total PnL:       $${r.totalPnL.toFixed(2)} (${r.returnPct.toFixed(2)}%)`);
  console.log(`Max drawdown:    $${r.maxDrawdown.toFixed(2)} (${r.maxDrawdownPct.toFixed(2)}%)`);
  console.log(`Sharpe ratio:    ${r.sharpeRatio.toFixed(2)}`);
  console.log(`Spread model:    ${typeof r.config.spread === "number" ? r.config.spread + " (flat)" : "per-instrument"}`);
  console.log("");
  console.log(`Total trades:    ${r.totalTrades}`);
  console.log(`Win rate:        ${(r.winRate * 100).toFixed(1)}%`);
  console.log(`Avg win:         $${r.avgWin.toFixed(2)}`);
  console.log(`Avg loss:        $${r.avgLoss.toFixed(2)}`);
  console.log(`Profit factor:   ${r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2)}`);

  if (r.trades.length > 0) {
    console.log(`\nLast 10 trades:`);
    const recent = r.trades.slice(-10);
    for (const t of recent) {
      const time = new Date(t.exitTime).toISOString().slice(11, 19);
      const sign = t.pnl >= 0 ? "+" : "";
      console.log(
        `  ${t.instrument.padEnd(7)} ${t.side.padEnd(4)} ${t.units}u @ ${t.entryPrice.toFixed(5)} → ${t.exitPrice.toFixed(5)}  ${sign}$${t.pnl.toFixed(2)}  (${time})`,
      );
    }
  }
  console.log("");
}
