<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { invalidateAll } from "$app/navigation";

	let { data } = $props();
	// svelte-ignore state_referenced_locally
	const initialGranularity = data.availableGranularities[0]?.name ?? "M1";

	interface ConfigFieldDef {
		label: string;
		type: "number" | "text";
		default?: unknown;
		placeholder?: string;
		min?: number;
		step?: number;
	}

	interface RunningBacktest {
		id: string;
		strategy: string;
		granularity: string;
		startedAt: string;
		status: "running" | "done" | "error";
		lastOutput: string;
	}

	let runningBacktests = $state<RunningBacktest[]>([]);
	let btPollInterval: ReturnType<typeof setInterval> | null = null;
	let actionMessage = $state("");
	let actionError = $state("");
	let running = $state(false);
	let backtestGranularity = $state(initialGranularity);
	let showAdvanced = $state(false);
	let btSpreadMult = $state(1.5);
	let btExecDelay = $state(1);
	let btTimeVaryingSpread = $state(true);
	let btSlippage = $state(0.5);
	let btFromDate = $state("");
	let btToDate = $state("");
	let btBalance = $state(1000);
	let strategyConfig = $state<Record<string, unknown>>({});
	let btPreset = $state("realistic");

	const GRAN_SECONDS: Record<string, number> = {
		S5: 5, S10: 10, S15: 15, S30: 30,
		M1: 60, M2: 120, M4: 240, M5: 300,
		M10: 600, M15: 900, M30: 1800,
		H1: 3600, H2: 7200, H3: 10800, H4: 14400,
		H6: 21600, H8: 28800, H12: 43200,
		D: 86400, W: 604800,
	};

	const granMap = $derived.by(() => {
		const m = new Map<string, { from: string; to: string }>();
		for (const g of data.availableGranularities) {
			const existing = m.get(g.name);
			if (!existing || g.from < existing.from) m.set(g.name, { from: g.from, to: g.to });
			else if (g.to > existing.to) m.set(g.name, { from: existing.from, to: g.to });
		}
		return m;
	});
	const granularities = $derived([...granMap.keys()].sort((a, b) => (GRAN_SECONDS[a] ?? 0) - (GRAN_SECONDS[b] ?? 0)));

	const presets: Record<string, { label: string; spreadMult: number; slippage: number; execDelay: number; timeVarying: boolean }> = {
		ideal: { label: "Ideal", spreadMult: 1.0, slippage: 0, execDelay: 0, timeVarying: false },
		realistic: { label: "Realistic", spreadMult: 1.5, slippage: 0.5, execDelay: 1, timeVarying: true },
		worst: { label: "Worst Case", spreadMult: 2.0, slippage: 1.0, execDelay: 2, timeVarying: true },
	};

	function applyPreset(key: string) {
		btPreset = key;
		const p = presets[key];
		if (!p) return;
		btSpreadMult = p.spreadMult;
		btSlippage = p.slippage;
		btExecDelay = p.execDelay;
		btTimeVaryingSpread = p.timeVarying;
	}

	function getFields(): [string, ConfigFieldDef][] {
		const fields = data.strategy.configFields;
		if (!fields) return [];
		return [
			...Object.entries(fields.common ?? {}),
			...Object.entries(fields.backtest ?? {}),
		];
	}

	const backtestFields = $derived(getFields());

	$effect(() => {
		const range = granMap.get(backtestGranularity);
		if (range) { btFromDate = range.from; btToDate = range.to; }
	});

	$effect(() => {
		const newConfig: Record<string, unknown> = {};
		for (const [key, def] of backtestFields) {
			newConfig[key] = def.default ?? (def.type === "number" ? 0 : "");
		}
		strategyConfig = newConfig;
	});

	async function pollBacktests() {
		try {
			const res = await fetch("/api/backtests?type=running");
			if (res.ok) {
				const all: RunningBacktest[] = await res.json();
				runningBacktests = all.filter((b) => b.strategy === data.strategy.id);
				if (all.some((b) => b.status !== "running")) {
					await invalidateAll();
				}
			}
		} catch { /* ignore */ }
	}

	onMount(() => {
		pollBacktests();
		btPollInterval = setInterval(pollBacktests, 3000);
	});
	onDestroy(() => { if (btPollInterval) clearInterval(btPollInterval); });

	async function runBacktest() {
		running = true;
		actionMessage = "";
		actionError = "";
		const body: Record<string, unknown> = {
			strategy: data.strategy.id,
			granularity: backtestGranularity,
			strategyConfig,
		};
		if (btSpreadMult !== 1.0) body.spreadMult = btSpreadMult;
		if (btExecDelay > 0) body.execDelay = btExecDelay;
		if (btTimeVaryingSpread) body.timeVaryingSpread = true;
		if (btSlippage > 0) body.slippage = btSlippage;
		if (btFromDate) body.fromDate = btFromDate;
		if (btToDate) body.toDate = btToDate;
		if (btBalance !== 1000) body.balance = btBalance;

		const res = await fetch("/api/backtest/run", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const result = await res.json();
		if (res.ok) {
			actionMessage = result.message;
			await pollBacktests();
		} else {
			actionError = result.error;
		}
		running = false;
	}

	// Results display
	let expanded = $state<Set<string>>(new Set());
	function toggle(filename: string) {
		if (expanded.has(filename)) expanded.delete(filename);
		else expanded.add(filename);
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

	let deleteTarget = $state<string | null>(null);

	async function deleteReport() {
		if (!deleteTarget) return;
		const res = await fetch(`/backtests/${deleteTarget}`, { method: "DELETE" });
		if (res.ok) {
			deleteTarget = null;
			await invalidateAll();
		}
	}

	function rerun(report: typeof data.reports[0]) {
		backtestGranularity = report.granularity;

		if (report.backtestConfig) {
			const cfg = report.backtestConfig;
			btSpreadMult = cfg.spreadMultiplier ?? 1.5;
			btExecDelay = cfg.executionDelay ?? 1;
			btTimeVaryingSpread = cfg.timeVaryingSpread ?? true;
			btSlippage = cfg.slippagePips ?? 0.5;
			if (cfg.fromDate) btFromDate = cfg.fromDate;
			if (cfg.toDate) btToDate = cfg.toDate;

			// Detect preset
			if (btSpreadMult === 1 && btExecDelay === 0 && !btTimeVaryingSpread) btPreset = "ideal";
			else if (btSpreadMult >= 2 && btExecDelay >= 2 && btTimeVaryingSpread) btPreset = "worst";
			else btPreset = "realistic";
		}

		if (report.strategyConfig) {
			strategyConfig = { ...strategyConfig, ...report.strategyConfig };
		}

		// Scroll to top of the form
		window.scrollTo({ top: 0, behavior: "smooth" });
	}
</script>

<div class="backtests-tab">
	{#if actionMessage}
		<div class="success">{actionMessage}</div>
	{/if}
	{#if actionError}
		<div class="error">{actionError}</div>
	{/if}

	<section class="runner">
		<h2>Run Backtest</h2>
		<div class="action-row">
			<select bind:value={backtestGranularity}>
				{#each granularities as g}
					<option value={g}>{g}</option>
				{/each}
			</select>
			<select bind:value={btPreset} onchange={(e) => applyPreset((e.target as HTMLSelectElement).value)}>
				{#each Object.entries(presets) as [key, p]}
					<option value={key}>{p.label}</option>
				{/each}
			</select>
			<button class="btn-primary" onclick={runBacktest} disabled={running}>{running ? "Starting..." : "Run"}</button>
		</div>

		<div class="date-row">
			<span class="label">Range</span>
			<input type="date" bind:value={btFromDate} />
			<span class="sep">to</span>
			<input type="date" bind:value={btToDate} />
			<span class="sep">|</span>
			<span class="label">Balance</span>
			<input type="number" bind:value={btBalance} min="100" step="100" class="balance-input" />
		</div>

		{#if backtestFields.length > 0}
			<div class="strategy-options">
				{#each backtestFields as [key, field] (key)}
					<label>
						<span>{field.label}</span>
						{#if field.type === "number"}
							<input type="number"
								value={strategyConfig[key] ?? field.default ?? 0}
								oninput={(e) => { strategyConfig[key] = parseFloat((e.target as HTMLInputElement).value) || 0; }}
								min={field.min} step={field.step} />
						{:else}
							<input type="text"
								value={strategyConfig[key] ?? field.default ?? ""}
								oninput={(e) => { strategyConfig[key] = (e.target as HTMLInputElement).value; }}
								placeholder={field.placeholder} />
						{/if}
					</label>
				{/each}
			</div>
		{/if}

		<button class="btn-toggle" onclick={() => showAdvanced = !showAdvanced}>
			{showAdvanced ? "Hide" : "Show"} execution overrides
		</button>

		{#if showAdvanced}
			<div class="advanced">
				<div class="option-grid">
					<label><span>Spread multiplier</span><input type="number" bind:value={btSpreadMult} min="0.1" step="0.1" /></label>
					<label><span>Slippage (pips)</span><input type="number" bind:value={btSlippage} min="0" step="0.1" /></label>
					<label><span>Execution delay (ticks)</span><input type="number" bind:value={btExecDelay} min="0" /></label>
					<label class="checkbox-label"><input type="checkbox" bind:checked={btTimeVaryingSpread} /><span>Time-varying spreads</span></label>
				</div>
			</div>
		{/if}

		{#if runningBacktests.length > 0}
			<div class="running">
				{#each runningBacktests as bt}
					<div class="bt-row" class:bt-done={bt.status === "done"} class:bt-error={bt.status === "error"}>
						<span class="bt-indicator" class:spinning={bt.status === "running"}>
							{bt.status === "running" ? "⟳" : bt.status === "done" ? "✓" : "✗"}
						</span>
						<span class="bt-gran">{bt.granularity}</span>
						<span class="bt-output">{bt.lastOutput}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if data.reports.length > 0}
		<section>
			<h2>Results</h2>
			<table>
				<thead>
					<tr>
						<th></th>
						<th>Gran</th>
						<th>Preset</th>
						<th>Return</th>
						<th>PF</th>
						<th>Win%</th>
						<th>Trades</th>
						<th>Max DD</th>
						<th>Sharpe</th>
						<th>When</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.reports as report}
						{@const m = report.metrics}
						{@const isOpen = expanded.has(report.filename)}
						<tr class="summary-row" onclick={() => toggle(report.filename)}>
							<td class="chevron">{isOpen ? "▾" : "▸"}</td>
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
							<td class="report-links" onclick={(e) => e.stopPropagation()}>
								<button class="btn-rerun" onclick={() => rerun(report)}>Rerun</button>
								<a href="/backtests/{report.filename}" target="_blank">HTML</a>
								<a href="/backtests/{report.filename}/csv">CSV</a>
								<button class="btn-link" disabled title="Coming soon">Share</button>
								<button class="btn-link btn-delete" onclick={() => deleteTarget = report.filename}>Delete</button>
							</td>
						</tr>
						{#if isOpen}
							<tr class="detail-row">
								<td colspan="11">
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
		</section>
	{/if}

	{#if deleteTarget}
		<div class="modal-backdrop" role="none" onclick={() => deleteTarget = null}>
			<div class="modal" role="none" onclick={(e) => e.stopPropagation()}>
				<h3>Delete backtest result?</h3>
				<p class="modal-warning">This will remove the JSON, HTML, and CSV files. This cannot be undone.</p>
				<div class="modal-actions">
					<button class="btn-action" onclick={() => deleteTarget = null}>Cancel</button>
					<button class="btn-primary btn-danger" onclick={deleteReport}>Delete</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	h2 { font-size: 1em; color: #8b949e; border-bottom: 1px solid #21262d; padding-bottom: 6px; margin: 0 0 12px; }
	.success { background: #0d2818; color: #3fb950; padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 12px; }
	.error { background: #5d1a1a; color: #f85149; padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 12px; }
	.runner { margin-bottom: 24px; }
	.action-row { display: flex; gap: 8px; align-items: center; }
	select, input { padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85em; }
	select:focus, input:focus { outline: none; border-color: #58a6ff; }
	.btn-primary { padding: 6px 16px; background: #238636; color: #fff; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.85em; }
	.btn-primary:hover { background: #2ea043; }
	.date-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
	.label { color: #8b949e; font-size: 0.85em; }
	.sep { color: #8b949e; font-size: 0.85em; }
	.balance-input { width: 90px; }
	.strategy-options { display: flex; gap: 12px; align-items: flex-end; margin-top: 10px; }
	.strategy-options label span { display: block; font-size: 0.82em; color: #8b949e; margin-bottom: 4px; }
	.strategy-options input { width: 100%; box-sizing: border-box; }
	.btn-toggle { background: none; border: none; color: #58a6ff; cursor: pointer; font-size: 0.85em; padding: 4px 0; margin-top: 8px; }
	.btn-toggle:hover { text-decoration: underline; }
	.advanced { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 16px; margin-top: 8px; }
	.option-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	.option-grid label span { display: block; font-size: 0.82em; color: #8b949e; margin-bottom: 4px; }
	.option-grid input[type="number"] { width: 100%; box-sizing: border-box; }
	.checkbox-label { display: flex !important; flex-direction: row !important; align-items: center; gap: 6px; }
	.checkbox-label input[type="checkbox"] { width: auto; }
	.checkbox-label span { margin-bottom: 0 !important; }
	.running { margin-top: 12px; border: 1px solid #21262d; border-radius: 6px; overflow: hidden; }
	.bt-row { display: flex; align-items: center; gap: 10px; padding: 6px 12px; font-size: 0.85em; border-bottom: 1px solid #21262d; }
	.bt-row:last-child { border-bottom: none; }
	.bt-done { opacity: 0.6; }
	.bt-error .bt-indicator { color: #f85149; }
	.bt-indicator { width: 16px; text-align: center; }
	.bt-indicator.spinning { animation: spin 1s linear infinite; color: #58a6ff; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.bt-gran { color: #8b949e; min-width: 30px; }
	.bt-output { color: #8b949e; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Results table */
	table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
	th { text-align: left; padding: 6px 10px; color: #8b949e; border-bottom: 2px solid #21262d; white-space: nowrap; }
	td { padding: 6px 10px; border-bottom: 1px solid #21262d; white-space: nowrap; }
	.summary-row { cursor: pointer; }
	.summary-row:hover td { background: #1c2128; }
	.chevron { color: #8b949e; width: 16px; font-size: 0.8em; }
	.preset { color: #8b949e; }
	.when { color: #8b949e; font-size: 0.9em; }
	.pos { color: #3fb950; }
	.neg { color: #f85149; }
	.muted { color: #8b949e; }
	.report-links { display: flex; gap: 8px; }
	.report-links a { font-size: 0.85em; color: #58a6ff; }
	.btn-rerun { background: none; border: none; color: #58a6ff; cursor: pointer; font-size: 0.85em; padding: 0; }
	.btn-rerun:hover { text-decoration: underline; }
	.btn-link { background: none; border: none; color: #58a6ff; cursor: pointer; font-size: 0.85em; padding: 0; }
	.btn-link:hover { text-decoration: underline; }
	.btn-link:disabled { color: #484f58; cursor: not-allowed; text-decoration: none; }
	.btn-delete { color: #f85149; }
	.btn-action { padding: 4px 10px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; font-size: 0.82em; cursor: pointer; }
	.btn-action:hover { background: #30363d; }
	.btn-primary { padding: 6px 16px; background: #238636; color: #fff; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.85em; }
	.btn-primary.btn-danger { background: #da3633; }
	.btn-primary.btn-danger:hover { background: #f85149; }
	.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
	.modal { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px; min-width: 340px; max-width: 440px; }
	.modal h3 { margin: 0 0 12px; font-size: 1em; }
	.modal-warning { color: #8b949e; font-size: 0.85em; margin: 8px 0; }
	.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
	.detail-row td { padding: 0; border-bottom: 2px solid #21262d; }
	.detail-panel { display: flex; gap: 32px; padding: 12px 16px 12px 32px; background: #161b22; }
	.detail-section h4 { font-size: 0.8em; color: #8b949e; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.05em; }
	.detail-grid { display: grid; grid-template-columns: auto auto; gap: 2px 12px; font-size: 0.9em; }
	.dl { color: #8b949e; }
	.dv { color: #c9d1d9; }
</style>
