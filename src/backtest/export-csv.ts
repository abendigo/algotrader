import type { BacktestResult, Trade } from "./types.js";
import type { TestResult, TestTrade } from "../core/test-result.js";

/** Generate a CSV string from test results (backtest or paper trading) */
export function exportCSV(result: TestResult | BacktestResult): string {
  const headers = [
    "Trade #",
    "Instrument",
    "Side",
    "Units",
    "Entry Time",
    "Exit Time",
    "Duration (min)",
    "Entry Price",
    "Exit Price",
    "PnL (account)",
    "PnL (quote)",
    "Quote Currency",
    "Account Currency",
    "Conversion Rate",
    "Conversion Pair",
    "Entry Z-Score",
    "Exit Z-Score",
    "Entry Deviation %",
    "Exit Deviation %",
    "Implied Rate (entry)",
    "Actual Rate (entry)",
    "Leg A",
    "Leg A Price (entry)",
    "Leg B",
    "Leg B Price (entry)",
    "Entry Reason",
    "Exit Reason",
  ];

  const rows = result.trades.map((t, i) => {
    const durationMin = ((t.exitTime - t.entryTime) / 60000).toFixed(1);
    const bt = t as Trade;
    const es = bt.entrySignal;
    const xs = bt.exitSignal;

    const entryReason = es
      ? `Z=${es.zScore.toFixed(2)}, actual ${es.actualRate.toFixed(5)} vs implied ${es.impliedRate.toFixed(5)} (dev ${es.deviation.toFixed(4)}%)`
      : "";
    const exitReason = xs
      ? `Z reverted to ${xs.zScore.toFixed(2)} (dev ${xs.deviation.toFixed(4)}%)`
      : "";

    return [
      i + 1,
      t.instrument,
      t.side,
      t.units,
      new Date(t.entryTime).toISOString(),
      new Date(t.exitTime).toISOString(),
      durationMin,
      t.entryPrice.toFixed(5),
      t.exitPrice.toFixed(5),
      t.pnl.toFixed(2),
      bt.conversion?.pnlQuote?.toFixed(5) ?? "",
      bt.conversion?.quoteCurrency ?? "",
      bt.conversion?.accountCurrency ?? "",
      bt.conversion?.conversionRate?.toFixed(6) ?? "",
      bt.conversion?.conversionPair ?? "",
      es?.zScore.toFixed(3) ?? "",
      xs?.zScore.toFixed(3) ?? "",
      es?.deviation.toFixed(4) ?? "",
      xs?.deviation.toFixed(4) ?? "",
      es?.impliedRate.toFixed(5) ?? "",
      es?.actualRate.toFixed(5) ?? "",
      es?.legA ?? "",
      es?.legAPrice.toFixed(5) ?? "",
      es?.legB ?? "",
      es?.legBPrice.toFixed(5) ?? "",
      entryReason,
      exitReason,
    ];
  });

  const csvEscape = (v: string | number) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}
