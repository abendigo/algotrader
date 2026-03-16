import type { BacktestResult, Trade } from "./types.js";

/** Generate a self-contained HTML report from backtest results */
export function exportHTML(result: BacktestResult, strategyName?: string): string {
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
    .map((t, i) => buildTradeRow(t, i + 1))
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
</style>
</head>
<body>

<h1>${strategyName ?? "Strategy"} — Backtest Report</h1>
<p style="color:#8b949e; font-size:0.9em">${startDate} to ${endDate} &middot; ${r.totalTicks.toLocaleString()} ticks &middot; ${r.config.granularity} data</p>

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

function buildTradeRow(t: Trade, num: number): string {
  const entryTime = new Date(t.entryTime).toISOString().slice(0, 19).replace("T", " ");
  const exitTime = new Date(t.exitTime).toISOString().slice(0, 19).replace("T", " ");
  const durationMin = ((t.exitTime - t.entryTime) / 60000).toFixed(0);
  const pnlClass = t.pnl >= 0 ? "pos" : "neg";
  const pnlSign = t.pnl >= 0 ? "+" : "";

  const es = t.entrySignal;
  const xs = t.exitSignal;

  let entryReason = "";
  if (es) {
    const dir = es.zScore > 0 ? "above" : "below";
    entryReason =
      `Z-score ${es.zScore.toFixed(2)} exceeded threshold. ` +
      `Actual ${es.actualRate.toFixed(5)} is ${dir} implied ${es.impliedRate.toFixed(5)} ` +
      `(dev ${es.deviation.toFixed(4)}%, mean ${es.deviationMean.toFixed(4)}%, std ${es.deviationStd.toFixed(4)}%). ` +
      `Legs: ${es.legA}=${es.legAPrice.toFixed(5)}, ${es.legB}=${es.legBPrice.toFixed(5)}`;
  }

  let exitReason = "";
  if (xs) {
    exitReason =
      `Z-score reverted to ${xs.zScore.toFixed(2)}. ` +
      `Deviation narrowed to ${xs.deviation.toFixed(4)}% (from ${es?.deviation.toFixed(4) ?? "?"}%). ` +
      `Actual ${xs.actualRate.toFixed(5)} vs implied ${xs.impliedRate.toFixed(5)}`;
  }

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
    const label = new Date(t).toISOString().slice(11, 16);
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
