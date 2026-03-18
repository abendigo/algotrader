<script lang="ts">
	let { data } = $props();
	let expanded = $state<Set<string>>(new Set());

	function toggle(filename: string) {
		if (expanded.has(filename)) {
			expanded.delete(filename);
		} else {
			expanded.add(filename);
		}
		expanded = new Set(expanded);
	}

	function presetLabel(cfg: any): string {
		if (!cfg) return "";
		const sm = cfg.spreadMultiplier ?? 1;
		const ed = cfg.executionDelay ?? 0;
		const tv = cfg.timeVaryingSpread ?? false;
		if (sm === 1 && ed === 0 && !tv) return "Ideal";
		if (sm >= 2 && ed >= 2 && tv) return "Worst";
		if (sm > 1 && tv) return "Realistic";
		return `${sm}x`;
	}

	function fmtPct(n: number): string {
		return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
	}
</script>

<h1>Backtests</h1>

{#if data.reports.length === 0}
	<p class="muted">No reports found. Run a backtest from the <a href="/strategies/mine">Strategies</a> page.</p>
{:else}
	<table>
		<thead>
			<tr>
				<th></th>
				<th>Strategy</th>
				<th>Gran</th>
				<th>Preset</th>
				<th>Return</th>
				<th>PF</th>
				<th>Win%</th>
				<th>Trades</th>
				<th>Max DD</th>
				<th>Sharpe</th>
				<th>When</th>
			</tr>
		</thead>
		<tbody>
			{#each data.reports as report}
				{@const m = report.metrics}
				{@const isOpen = expanded.has(report.filename)}
				<tr class="summary-row" onclick={() => toggle(report.filename)}>
					<td class="chevron">{isOpen ? "▾" : "▸"}</td>
					<td class="name">{report.strategy}</td>
					<td>{report.granularity}</td>
					<td class="preset">{presetLabel(report.backtestConfig)}</td>
					{#if m}
						<td class:pos={m.returnPct > 0} class:neg={m.returnPct < 0}>{fmtPct(m.returnPct)}</td>
						<td class:pos={m.profitFactor > 1} class:neg={m.profitFactor < 1}>{m.profitFactor.toFixed(2)}</td>
						<td>{(m.winRate * 100).toFixed(0)}%</td>
						<td>{m.totalTrades}</td>
						<td class="neg">{fmtPct(-m.maxDrawdownPct)}</td>
						<td>{m.sharpeRatio.toFixed(2)}</td>
					{:else}
						<td colspan="6" class="muted">—</td>
					{/if}
					<td class="when">{report.timestamp.slice(0, 16).replace("T", " ")}</td>
				</tr>
				{#if isOpen}
					<tr class="detail-row">
						<td colspan="12">
							<div class="detail-panel">
								{#if report.backtestConfig}
									{@const cfg = report.backtestConfig}
									<div class="detail-section">
										<h4>Execution Model</h4>
										<div class="detail-grid">
											<span class="dl">Spread</span><span class="dv">{cfg.spreadMultiplier}x{cfg.timeVaryingSpread ? " time-varying" : " fixed"}</span>
											{#if cfg.slippagePips}<span class="dl">Slippage</span><span class="dv">{cfg.slippagePips} pips</span>{/if}
											{#if cfg.executionDelay}<span class="dl">Exec delay</span><span class="dv">{cfg.executionDelay} tick{cfg.executionDelay !== 1 ? "s" : ""}</span>{/if}
										</div>
									</div>
									{#if cfg.fromDate}
										<div class="detail-section">
											<h4>Data Range</h4>
											<div class="detail-grid">
												<span class="dl">From</span><span class="dv">{cfg.fromDate}</span>
												<span class="dl">To</span><span class="dv">{cfg.toDate}</span>
											</div>
										</div>
									{/if}
								{/if}
								{#if report.strategyConfig && Object.keys(report.strategyConfig).length > 0}
									<div class="detail-section">
										<h4>Strategy Parameters</h4>
										<div class="detail-grid">
											{#each Object.entries(report.strategyConfig).filter(([, v]) => v != null && v !== 0 && v !== "") as [key, val]}
												<span class="dl">{key}</span>
												<span class="dv">{Array.isArray(val) ? val.join(", ") : val}</span>
											{/each}
										</div>
									</div>
								{/if}
								{#if m}
									<div class="detail-section">
										<h4>Balance</h4>
										<div class="detail-grid">
											<span class="dl">Final</span><span class="dv">${m.finalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
										</div>
									</div>
								{/if}
							</div>
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
{/if}

<style>
	h1 {
		font-size: 1.4em;
		margin-bottom: 16px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85em;
	}
	th {
		text-align: left;
		padding: 6px 10px;
		color: #8b949e;
		border-bottom: 2px solid #21262d;
		white-space: nowrap;
	}
	td {
		padding: 6px 10px;
		border-bottom: 1px solid #21262d;
		white-space: nowrap;
	}
	.summary-row { cursor: pointer; }
	.summary-row:hover td { background: #1c2128; }
	.chevron { color: #8b949e; width: 16px; font-size: 0.8em; }
	.name { font-weight: 600; }
	.preset { color: #8b949e; }
	.when { color: #8b949e; font-size: 0.9em; }
	.pos { color: #3fb950; }
	.neg { color: #f85149; }
	.muted { color: #8b949e; }
.detail-row td {
		padding: 0;
		border-bottom: 2px solid #21262d;
	}
	.detail-panel {
		display: flex;
		gap: 32px;
		padding: 12px 16px 12px 32px;
		background: #161b22;
	}
	.detail-section h4 {
		font-size: 0.8em;
		color: #8b949e;
		margin: 0 0 6px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.detail-grid {
		display: grid;
		grid-template-columns: auto auto;
		gap: 2px 12px;
		font-size: 0.9em;
	}
	.dl { color: #8b949e; }
	.dv { color: #c9d1d9; }
</style>
