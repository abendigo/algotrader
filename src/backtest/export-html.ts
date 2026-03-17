import type { BacktestConfig, BacktestResult, Trade } from "./types.js";

function getStrategyExplainer(strategy?: string): string {
  const wrap = (html: string) =>
    `<div class="explainer"><h2>How This Strategy Works</h2>${html}</div>`;

  switch (strategy) {
    case "london-breakout":
      return wrap(`
        <p><strong>London Breakout</strong> trades the directional move that occurs when the London session opens.</p>
        <dl>
          <dt>Setup</dt>
          <dd>During the Asian session (00:00&ndash;07:00 London time), price consolidates into a tight range as only Tokyo/Sydney are active. The <em>Asian range</em> is the high and low of this period.</dd>
          <dt>Entry</dt>
          <dd>After 08:00 London time, if price breaks above the Asian high &rarr; <strong>buy</strong>. If it breaks below the Asian low &rarr; <strong>sell</strong>. The breakout must exceed 10% of the range to filter noise.</dd>
          <dt>Stop Loss</dt>
          <dd>Placed at the opposite side of the Asian range. If you bought the upside breakout, the stop is at the Asian low.</dd>
          <dt>Exit</dt>
          <dd>Position is closed at London session end (16:00 London time). Fridays are skipped (historically poor performance).</dd>
        </dl>
        <h3>Trade Journal Fields</h3>
        <dl>
          <dt>Entry Reason</dt>
          <dd><em>Asian range</em>: the overnight high/low levels. <em>Range %</em>: range size as a percentage of price. <em>Breakout at</em>: the price when the breakout was confirmed.</dd>
          <dt>Exit Reason</dt>
          <dd>Either <em>stop-loss</em> (hit opposite side of range) or <em>session-end</em> (16:00 London close). Shows the exit price and where the stop was.</dd>
        </dl>`);

    case "range-fade":
      return wrap(`
        <p><strong>Range Fade</strong> is the opposite of London Breakout &mdash; it bets that breakouts of the Asian range will fail and price will return inside.</p>
        <dl>
          <dt>Setup</dt>
          <dd>Same Asian range measurement (00:00&ndash;07:00 London time).</dd>
          <dt>Entry</dt>
          <dd>Waits for price to break above the Asian high (or below the low), then <em>reverse back inside the range</em>. If the upside breakout fails &rarr; <strong>sell</strong>. If the downside breakout fails &rarr; <strong>buy</strong>.</dd>
          <dt>Stop Loss</dt>
          <dd>Beyond the breakout extreme (the furthest point the breakout reached before reversing).</dd>
          <dt>Take Profit</dt>
          <dd>Near the opposite side of the Asian range (80% of range).</dd>
        </dl>`);

    case "session-divergence":
      return wrap(`
        <p><strong>Session Open Divergence</strong> trades cross-currency mispricings at the open of major sessions.</p>
        <dl>
          <dt>Signal</dt>
          <dd>At the start of London (08:00) or New York (09:30 local) sessions, each cross pair's actual rate is compared to its <em>implied rate</em> derived from the two USD-leg majors. The cross with the largest deviation is selected.</dd>
          <dt>Entry</dt>
          <dd>If the cross is above implied &rarr; <strong>sell</strong> (expect reversion down). If below &rarr; <strong>buy</strong>.</dd>
          <dt>Exit</dt>
          <dd>When the deviation reverts by 70%, or stop loss / session end is hit.</dd>
        </dl>
        <h3>Trade Journal Fields</h3>
        <dl>
          <dt>Deviation %</dt>
          <dd>How far the actual cross rate is from the USD-implied rate, as a percentage.</dd>
          <dt>Threshold multiple</dt>
          <dd>The deviation divided by the minimum threshold &mdash; higher = stronger signal.</dd>
        </dl>`);

    case "correlation-pairs":
      return wrap(`
        <p><strong>Correlation Pairs</strong> trades the spread between two highly correlated instruments (AUD/USD and NZD/USD, ~95% correlation).</p>
        <dl>
          <dt>Signal</dt>
          <dd>Computes the ratio AUD_USD / NZD_USD over a rolling window. When the z-score of this ratio exceeds &plusmn;2.0, the spread has diverged from its historical norm.</dd>
          <dt>Entry</dt>
          <dd>Z &gt; 2.0: spread too wide &rarr; <strong>short AUD_USD, long NZD_USD</strong>. Z &lt; -2.0: spread too narrow &rarr; <strong>long AUD_USD, short NZD_USD</strong>.</dd>
          <dt>Exit</dt>
          <dd>When z-score reverts past &plusmn;0.5, or hits stop z-score (3.5), or max hold time.</dd>
        </dl>
        <h3>Trade Journal Fields</h3>
        <dl>
          <dt>Z-Score</dt>
          <dd>Standard deviations of the price ratio from its rolling mean.</dd>
          <dt>Ratio</dt>
          <dd>Current AUD_USD / NZD_USD price ratio vs the rolling mean.</dd>
        </dl>`);

    case "lead-lag":
      return wrap(`
        <p><strong>Lead-Lag Mean Reversion</strong> trades cross-currency pairs back toward their USD-implied fair value.</p>
        <dl>
          <dt>Signal</dt>
          <dd>For each cross (e.g., AUD_CAD), computes the implied rate from the two USD legs (AUD_USD and USD_CAD). The deviation between actual and implied is tracked with a rolling z-score.</dd>
          <dt>Entry</dt>
          <dd>When |z-score| exceeds the entry threshold (2.0), enter against the deviation: sell if actual is above implied, buy if below.</dd>
          <dt>Exit</dt>
          <dd>When |z-score| drops below the exit threshold (0.5).</dd>
        </dl>`);

    case "cross-drift":
      return wrap(`
        <p><strong>Cross-Rate Drift</strong> combines trend detection with lead-lag entry timing.</p>
        <dl>
          <dt>Signal</dt>
          <dd>Detects the drift direction of each cross using linear regression over a slow window, then uses the lead-lag deviation for entry timing &mdash; only entering in the drift direction when the deviation gives a favorable price.</dd>
          <dt>Exit</dt>
          <dd>Take profit, stop loss, drift reversal, or max hold time.</dd>
        </dl>`);

    case "currency-momentum":
      return wrap(`
        <p><strong>Currency Strength Momentum</strong> ranks all 8 currencies by their rate-of-change against USD, then trades the cross between the strongest and weakest.</p>
        <dl>
          <dt>Entry</dt>
          <dd>When the momentum spread between strongest and weakest currencies exceeds the threshold, go long strongest vs short weakest via their cross pair.</dd>
          <dt>Exit</dt>
          <dd>When the ranking changes, or take profit / stop loss / max hold.</dd>
        </dl>`);

    case "cross-momentum":
      return wrap(`
        <p><strong>Cross-Pair Momentum</strong> trades <em>with</em> cross-rate deviations instead of against them. When a cross's deviation from its USD-implied rate is accelerating, enter in that direction.</p>
        <dl>
          <dt>Signal</dt>
          <dd>Rate-of-change of the deviation over a momentum window. Positive momentum = deviation growing = buy.</dd>
          <dt>Exit</dt>
          <dd>When momentum fades below a fraction of entry momentum, or stop loss / max hold.</dd>
        </dl>`);

    default:
      return "";
  }
}

export interface ReportMeta {
  strategyConfig?: Record<string, unknown>;
  backtestConfig?: Record<string, unknown> | BacktestConfig;
  paramDescriptions?: Record<string, string>;
}

function buildConfigSection(meta?: ReportMeta): string {
  if (!meta) return "";

  const rows: string[] = [];

  const addRow = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    const desc = meta.paramDescriptions?.[key] ?? "";
    const displayVal = typeof value === "boolean" ? (value ? "Yes" : "No") :
      Array.isArray(value) ? value.join(", ") : String(value);
    rows.push(`<tr><td><strong>${key}</strong></td><td>${displayVal}</td><td class="desc">${desc}</td></tr>`);
  };

  if (meta.backtestConfig) {
    for (const [k, v] of Object.entries(meta.backtestConfig)) {
      if (k === "spread" || k === "granularity") continue; // already shown elsewhere
      addRow(k, v);
    }
  }
  if (meta.strategyConfig) {
    for (const [k, v] of Object.entries(meta.strategyConfig)) {
      addRow(k, v);
    }
  }

  if (rows.length === 0) return "";

  return `
<h2>Configuration</h2>
<div class="trade-table-wrap" style="max-height:none">
<table>
  <thead><tr><th>Parameter</th><th>Value</th><th>Description</th></tr></thead>
  <tbody>${rows.join("\n")}</tbody>
</table>
</div>`;
}

/** Generate a self-contained HTML report from backtest results */
export function exportHTML(result: BacktestResult, strategyName?: string, meta?: ReportMeta): string {
  const r = result;
  const startDate = new Date(r.startTime).toISOString().slice(0, 16);
  const endDate = new Date(r.endTime).toISOString().slice(0, 16);

  // Build equity curve SVG
  const equitySVG = buildEquityCurve(r);

  // Build PnL distribution data
  const pnlByInstrument = new Map<string, { count: number; pnl: number; wins: number }>();
  for (const t of r.trades) {
    const entry = pnlByInstrument.get(t.instrument) ?? { count: 0, pnl: 0, wins: 0 };
    entry.count++;
    entry.pnl += t.pnl;
    if (t.pnl > 0) entry.wins++;
    pnlByInstrument.set(t.instrument, entry);
  }

  const instrumentRows = [...pnlByInstrument.entries()]
    .sort((a, b) => b[1].pnl - a[1].pnl)
    .map(
      ([inst, d]) =>
        `<tr>
          <td>${inst}</td>
          <td>${d.count}</td>
          <td>${((d.wins / d.count) * 100).toFixed(1)}%</td>
          <td class="${d.pnl >= 0 ? "pos" : "neg"}">$${d.pnl.toFixed(2)}</td>
        </tr>`,
    )
    .join("\n");

  const tradeRows = r.trades
    .map((t, i) => buildTradeRow(t, i + 1, strategyName))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Backtest Report — ${strategyName ?? "Strategy"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; padding: 24px; line-height: 1.5; }
  h1 { color: #58a6ff; margin-bottom: 8px; font-size: 1.4em; }
  h2 { color: #8b949e; margin: 24px 0 12px; font-size: 1.1em; border-bottom: 1px solid #21262d; padding-bottom: 6px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 12px 16px; }
  .card .label { font-size: 0.75em; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 1.3em; font-weight: 600; margin-top: 2px; }
  .pos { color: #3fb950; }
  .neg { color: #f85149; }
  .explainer { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 16px 20px; margin: 16px 0; font-size: 0.9em; line-height: 1.7; }
  .explainer p { margin-bottom: 12px; }
  .explainer dl { margin: 8px 0; }
  .explainer dt { color: #58a6ff; font-weight: 600; margin-top: 8px; }
  .explainer dd { color: #c9d1d9; margin-left: 16px; margin-bottom: 4px; }
  .explainer h3 { color: #8b949e; font-size: 0.95em; margin-top: 16px; margin-bottom: 4px; }
  .chart-container { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 16px; margin: 16px 0; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82em; }
  th { background: #161b22; color: #8b949e; text-align: left; padding: 8px 10px; position: sticky; top: 0; cursor: pointer; user-select: none; border-bottom: 2px solid #21262d; }
  th:hover { color: #58a6ff; }
  td { padding: 6px 10px; border-bottom: 1px solid #21262d; }
  tr:hover td { background: #1c2128; }
  .reason { font-size: 0.85em; color: #8b949e; max-width: 400px; }
  .trade-table-wrap { max-height: 600px; overflow-y: auto; border: 1px solid #21262d; border-radius: 6px; }
  .filters { margin: 12px 0; display: flex; gap: 8px; flex-wrap: wrap; }
  .filters select, .filters input { background: #161b22; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; padding: 4px 8px; font-size: 0.85em; }
  svg text { font-family: inherit; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.8em; font-weight: 600; }
  .badge.buy { background: #0d419d; color: #58a6ff; }
  .badge.sell { background: #5d1a1a; color: #f85149; }
  td.desc { color: #8b949e; font-size: 0.9em; }
</style>
</head>
<body>

<h1>${strategyName ?? "Strategy"} — Backtest Report</h1>
<p style="color:#8b949e; font-size:0.9em">${startDate} to ${endDate} &middot; ${r.totalTicks.toLocaleString()} ticks &middot; ${r.config.granularity} data</p>

${getStrategyExplainer(strategyName)}

${buildConfigSection(meta)}

<h2>Performance Summary</h2>
<div class="summary">
  <div class="card"><div class="label">Initial Balance</div><div class="value">$${r.initialBalance.toLocaleString()}</div></div>
  <div class="card"><div class="label">Final Balance</div><div class="value">$${r.finalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
  <div class="card"><div class="label">Total PnL</div><div class="value ${r.totalPnL >= 0 ? "pos" : "neg"}">$${r.totalPnL.toFixed(2)} (${r.returnPct.toFixed(2)}%)</div></div>
  <div class="card"><div class="label">Max Drawdown</div><div class="value neg">$${r.maxDrawdown.toFixed(2)} (${r.maxDrawdownPct.toFixed(2)}%)</div></div>
  <div class="card"><div class="label">Sharpe Ratio</div><div class="value">${r.sharpeRatio.toFixed(2)}</div></div>
  <div class="card"><div class="label">Total Trades</div><div class="value">${r.totalTrades}</div></div>
  <div class="card"><div class="label">Win Rate</div><div class="value">${(r.winRate * 100).toFixed(1)}%</div></div>
  <div class="card"><div class="label">Avg Win / Loss</div><div class="value"><span class="pos">$${r.avgWin.toFixed(2)}</span> / <span class="neg">$${r.avgLoss.toFixed(2)}</span></div></div>
  <div class="card"><div class="label">Profit Factor</div><div class="value">${r.profitFactor === Infinity ? "&infin;" : r.profitFactor.toFixed(2)}</div></div>
  <div class="card"><div class="label">Spread Model</div><div class="value">${typeof r.config.spread === "number" ? r.config.spread + " flat" : "Per-instrument"}</div></div>
</div>

<h2>Equity Curve</h2>
<div class="chart-container">
  ${equitySVG}
</div>

<h2>PnL by Instrument</h2>
<div class="trade-table-wrap" style="max-height:none">
<table>
  <thead><tr><th>Instrument</th><th>Trades</th><th>Win Rate</th><th>PnL</th></tr></thead>
  <tbody>${instrumentRows}</tbody>
</table>
</div>

<h2>Trade Journal</h2>
<div class="filters">
  <select id="instFilter" onchange="filterTrades()"><option value="">All Instruments</option></select>
  <select id="sideFilter" onchange="filterTrades()"><option value="">All Sides</option><option value="buy">Buy</option><option value="sell">Sell</option></select>
  <select id="pnlFilter" onchange="filterTrades()"><option value="">All PnL</option><option value="win">Winners</option><option value="loss">Losers</option></select>
</div>
<div class="trade-table-wrap">
<table id="tradeTable">
  <thead>
    <tr>
      <th onclick="sortTable(0)">#</th>
      <th onclick="sortTable(1)">Instrument</th>
      <th onclick="sortTable(2)">Side</th>
      <th onclick="sortTable(3)">Units</th>
      <th onclick="sortTable(4)">Entry Time</th>
      <th onclick="sortTable(5)">Exit Time</th>
      <th onclick="sortTable(6)">Duration</th>
      <th onclick="sortTable(7)">Entry Price</th>
      <th onclick="sortTable(8)">Exit Price</th>
      <th onclick="sortTable(9)">PnL</th>
      <th>Entry Reason</th>
      <th>Exit Reason</th>
    </tr>
  </thead>
  <tbody>
    ${tradeRows}
  </tbody>
</table>
</div>

<script>
// Populate instrument filter
const instruments = [...new Set(document.querySelectorAll('#tradeTable tbody tr'))].map(r => r.dataset.inst).filter(Boolean);
const instFilter = document.getElementById('instFilter');
[...new Set(instruments)].sort().forEach(inst => {
  const opt = document.createElement('option');
  opt.value = inst; opt.textContent = inst;
  instFilter.appendChild(opt);
});

function filterTrades() {
  const inst = document.getElementById('instFilter').value;
  const side = document.getElementById('sideFilter').value;
  const pnl = document.getElementById('pnlFilter').value;
  document.querySelectorAll('#tradeTable tbody tr').forEach(row => {
    let show = true;
    if (inst && row.dataset.inst !== inst) show = false;
    if (side && row.dataset.side !== side) show = false;
    if (pnl === 'win' && parseFloat(row.dataset.pnl) <= 0) show = false;
    if (pnl === 'loss' && parseFloat(row.dataset.pnl) > 0) show = false;
    row.style.display = show ? '' : 'none';
  });
}

let sortCol = -1, sortAsc = true;
function sortTable(col) {
  if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; }
  const tbody = document.querySelector('#tradeTable tbody');
  const rows = [...tbody.querySelectorAll('tr')];
  rows.sort((a, b) => {
    const av = a.children[col]?.dataset.sort ?? a.children[col]?.textContent ?? '';
    const bv = b.children[col]?.dataset.sort ?? b.children[col]?.textContent ?? '';
    const an = parseFloat(av), bn = parseFloat(bv);
    const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : av.localeCompare(bv);
    return sortAsc ? cmp : -cmp;
  });
  rows.forEach(r => tbody.appendChild(r));
}
</script>
</body>
</html>`;
}

function formatEntryReason(es: Trade["entrySignal"], strategy?: string): string {
  if (!es) return "";

  switch (strategy) {
    case "london-breakout":
    case "range-fade":
      return (
        `Asian range: ${es.legA}, ${es.legB} (range ${es.deviation.toFixed(3)}% of price). ` +
        `Breakout at ${es.actualRate.toFixed(5)}`
      );

    case "correlation-pairs":
      return (
        `Spread z-score ${es.zScore.toFixed(2)}. ` +
        `Ratio ${es.actualRate.toFixed(5)} vs mean ${es.deviationMean.toFixed(5)} (std ${es.deviationStd.toFixed(5)}). ` +
        `${es.legA}=${es.legAPrice.toFixed(5)}, ${es.legB}=${es.legBPrice.toFixed(5)}`
      );

    case "session-divergence":
      return (
        `Deviation ${es.deviation.toFixed(4)}% (${es.zScore.toFixed(1)}x threshold). ` +
        `Actual ${es.actualRate.toFixed(5)} vs implied ${es.impliedRate.toFixed(5)}. ` +
        `Legs: ${es.legA}=${es.legAPrice.toFixed(5)}, ${es.legB}=${es.legBPrice.toFixed(5)}`
      );

    default:
      // Generic lead-lag style
      return (
        `Z-score ${es.zScore.toFixed(2)}. ` +
        `Actual ${es.actualRate.toFixed(5)} vs implied ${es.impliedRate.toFixed(5)} ` +
        `(dev ${es.deviation.toFixed(4)}%). ` +
        `${es.legA}=${es.legAPrice.toFixed(5)}, ${es.legB}=${es.legBPrice.toFixed(5)}`
      );
  }
}

function formatExitReason(xs: Trade["exitSignal"], es: Trade["entrySignal"], strategy?: string): string {
  if (!xs) return "";

  switch (strategy) {
    case "london-breakout":
    case "range-fade":
      return `${xs.legB} at ${xs.actualRate.toFixed(5)}. SL was ${xs.legA}`;

    case "correlation-pairs":
      return (
        `Spread z-score ${xs.zScore.toFixed(2)}. ` +
        `Ratio ${xs.actualRate.toFixed(5)}. ` +
        `${xs.legA}=${xs.legAPrice.toFixed(5)}, ${xs.legB}=${xs.legBPrice.toFixed(5)}`
      );

    default:
      return (
        `Z-score ${xs.zScore.toFixed(2)}. ` +
        `Deviation ${xs.deviation.toFixed(4)}%. ` +
        `Price ${xs.actualRate.toFixed(5)}`
      );
  }
}

function buildTradeRow(t: Trade, num: number, strategy?: string): string {
  const entryTime = new Date(t.entryTime).toISOString().slice(0, 19).replace("T", " ");
  const exitTime = new Date(t.exitTime).toISOString().slice(0, 19).replace("T", " ");
  const durationMin = ((t.exitTime - t.entryTime) / 60000).toFixed(0);
  const pnlClass = t.pnl >= 0 ? "pos" : "neg";
  const pnlSign = t.pnl >= 0 ? "+" : "";

  const entryReason = formatEntryReason(t.entrySignal, strategy);
  const exitReason = formatExitReason(t.exitSignal, t.entrySignal, strategy);

  return `<tr data-inst="${t.instrument}" data-side="${t.side}" data-pnl="${t.pnl.toFixed(2)}">
    <td data-sort="${num}">${num}</td>
    <td>${t.instrument}</td>
    <td><span class="badge ${t.side}">${t.side.toUpperCase()}</span></td>
    <td>${t.units.toLocaleString()}</td>
    <td data-sort="${t.entryTime}">${entryTime}</td>
    <td data-sort="${t.exitTime}">${exitTime}</td>
    <td data-sort="${t.exitTime - t.entryTime}">${durationMin}m</td>
    <td>${t.entryPrice.toFixed(5)}</td>
    <td>${t.exitPrice.toFixed(5)}</td>
    <td class="${pnlClass}" data-sort="${t.pnl.toFixed(2)}">${pnlSign}$${t.pnl.toFixed(2)}</td>
    <td class="reason">${entryReason}</td>
    <td class="reason">${exitReason}</td>
  </tr>`;
}

function buildEquityCurve(r: BacktestResult): string {
  const curve = r.equityCurve;
  if (curve.length < 2) return "<p>Not enough data for chart</p>";

  const W = 900;
  const H = 250;
  const PAD = { top: 20, right: 20, bottom: 30, left: 70 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Downsample if too many points
  const maxPoints = 500;
  const step = Math.max(1, Math.floor(curve.length / maxPoints));
  const sampled = curve.filter((_, i) => i % step === 0);

  const minEq = Math.min(...sampled.map(([, e]) => e));
  const maxEq = Math.max(...sampled.map(([, e]) => e));
  const eqRange = maxEq - minEq || 1;
  const tMin = sampled[0][0];
  const tMax = sampled[sampled.length - 1][0];
  const tRange = tMax - tMin || 1;

  const x = (t: number) => PAD.left + ((t - tMin) / tRange) * plotW;
  const y = (e: number) => PAD.top + plotH - ((e - minEq) / eqRange) * plotH;

  // Build path
  const points = sampled.map(([t, e]) => `${x(t).toFixed(1)},${y(e).toFixed(1)}`);
  const linePath = `M${points.join("L")}`;

  // Fill area under curve
  const areaPath = `${linePath}L${x(tMax).toFixed(1)},${(PAD.top + plotH).toFixed(1)}L${x(tMin).toFixed(1)},${(PAD.top + plotH).toFixed(1)}Z`;

  // Y-axis labels
  const yLabels: string[] = [];
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const val = minEq + (eqRange * i) / ySteps;
    const yPos = y(val);
    yLabels.push(
      `<text x="${PAD.left - 8}" y="${yPos + 4}" text-anchor="end" fill="#8b949e" font-size="10">$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}</text>` +
        `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yPos}" y2="${yPos}" stroke="#21262d" stroke-width="1"/>`,
    );
  }

  // X-axis time labels
  const xLabels: string[] = [];
  const xSteps = 6;
  for (let i = 0; i <= xSteps; i++) {
    const t = tMin + (tRange * i) / xSteps;
    const xPos = x(t);
    // Show date for multi-day data, time for single-day
    const spanDays = tRange / 86_400_000;
    const label = spanDays > 2
      ? new Date(t).toISOString().slice(0, 10)   // YYYY-MM-DD
      : spanDays > 1
        ? new Date(t).toISOString().slice(5, 16).replace("T", " ")  // MM-DD HH:MM
        : new Date(t).toISOString().slice(11, 16); // HH:MM
    xLabels.push(
      `<text x="${xPos}" y="${H - 5}" text-anchor="middle" fill="#8b949e" font-size="10">${label}</text>`,
    );
  }

  // Color: green if profit, red if loss
  const color = r.totalPnL >= 0 ? "#3fb950" : "#f85149";

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${yLabels.join("")}
    ${xLabels.join("")}
    <defs>
      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#eqGrad)"/>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="1.5"/>
    <!-- Initial balance reference line -->
    <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(r.initialBalance)}" y2="${y(r.initialBalance)}" stroke="#8b949e" stroke-width="0.5" stroke-dasharray="4,4"/>
  </svg>`;
}
