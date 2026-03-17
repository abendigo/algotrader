<script lang="ts">
	import { onMount, onDestroy } from "svelte";

	let { data } = $props();

	// Poll for running backtests
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

	async function pollBacktests() {
		try {
			const res = await fetch("/api/backtests?type=running");
			if (res.ok) runningBacktests = await res.json();
		} catch { /* ignore */ }
	}

	onMount(() => {
		pollBacktests();
		btPollInterval = setInterval(pollBacktests, 3000);
	});

	onDestroy(() => {
		if (btPollInterval) clearInterval(btPollInterval);
	});

	async function clearFinished() {
		await fetch("/api/backtests?type=clear");
		await pollBacktests();
	}

	interface ConfigFieldDef {
		label: string;
		type: "number" | "text";
		default?: unknown;
		placeholder?: string;
		min?: number;
		step?: number;
	}

	interface ConfigFields {
		common?: Record<string, ConfigFieldDef>;
		backtest?: Record<string, ConfigFieldDef>;
		live?: Record<string, ConfigFieldDef>;
	}

	let actionMessage = $state("");
	let actionError = $state("");
	let backtestStrategy = $state("");
	let backtestGranularity = $state(data.availableGranularities[0]?.name ?? "M1");
	let showAdvanced = $state(false);
	let btSpreadMult = $state(1.5);
	let btExecDelay = $state(1);
	let btTimeVaryingSpread = $state(true);
	let btSlippage = $state(0.5);
	let btFromDate = $state("");
	let btToDate = $state("");
	let btBalance = $state(1000);
	let strategyConfig = $state<Record<string, unknown>>({});
	let liveStrategy = $state("");
	let liveAccountId = $state("");
	let liveConfig = $state<Record<string, unknown>>({});
	let btPreset = $state("realistic");

	// Build granularity lookup from available data
	const granMap = $derived.by(() => {
		const m = new Map<string, { from: string; to: string }>();
		for (const g of data.availableGranularities) {
			const existing = m.get(g.name);
			if (!existing || g.from < existing.from) m.set(g.name, { from: g.from, to: g.to });
			else if (g.to > existing.to) m.set(g.name, { from: existing.from, to: g.to });
		}
		return m;
	});
	const GRAN_SECONDS: Record<string, number> = {
		S5: 5, S10: 10, S15: 15, S30: 30,
		M1: 60, M2: 120, M4: 240, M5: 300,
		M10: 600, M15: 900, M30: 1800,
		H1: 3600, H2: 7200, H3: 10800, H4: 14400,
		H6: 21600, H8: 28800, H12: 43200,
		D: 86400, W: 604800,
	};
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

	function strategySlug(filename: string): string {
		return filename.replace(".ts", "");
	}

	// Strategies are already merged by the server with source field
	const allStrategies = $derived(
		data.strategies.map((s: any) => ({ id: s.id, name: s.name, source: s.source as "user" | "shared", configFields: (s.configFields ?? {}) as ConfigFields }))
	);

	const selectedStrategy = $derived(allStrategies.find((s) => s.id === backtestStrategy));

	/** Merge common + context-specific fields into a flat entries list */
	function getFields(fields: ConfigFields | undefined, context: "backtest" | "live"): [string, ConfigFieldDef][] {
		if (!fields) return [];
		return [
			...Object.entries(fields.common ?? {}),
			...Object.entries(fields[context] ?? {}),
		];
	}

	// Update date range when granularity changes
	$effect(() => {
		const range = granMap.get(backtestGranularity);
		if (range) {
			btFromDate = range.from;
			btToDate = range.to;
		}
	});

	const backtestFields = $derived(getFields(selectedStrategy?.configFields, "backtest"));
	const liveFields = $derived(getFields(allStrategies.find((s) => s.id === liveStrategy)?.configFields, "live"));

	// Reset config values when strategy changes
	$effect(() => {
		const newConfig: Record<string, unknown> = {};
		for (const [key, def] of backtestFields) {
			newConfig[key] = def.default ?? (def.type === "number" ? 0 : "");
		}
		strategyConfig = newConfig;
	});

	async function runBacktest() {
		if (!backtestStrategy) return;
		actionMessage = "";
		actionError = "";

		const body: Record<string, unknown> = {
			strategy: backtestStrategy,
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
		} else {
			actionError = result.error;
		}
	}

	// Reset live config when live strategy changes
	$effect(() => {
		const fields = liveFields;
		const newConfig: Record<string, unknown> = {};
		for (const [key, def] of fields) {
			newConfig[key] = def.default ?? (def.type === "number" ? 0 : "");
		}
		liveConfig = newConfig;
	});

	async function startLive() {
		if (!liveAccountId || !liveStrategy) return;
		actionMessage = "";
		actionError = "";

		const units = (liveConfig.units as number) || 100;
		const res = await fetch("/api/live/start", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ accountId: liveAccountId, strategy: liveStrategy, units }),
		});

		const result = await res.json();
		if (res.ok) {
			actionMessage = result.message;
		} else {
			actionError = result.error;
		}
	}
</script>

<div class="strategies-page">
	<div class="page-header">
		<h1>My Strategies</h1>
		<div class="tabs">
			<a href="/strategies/shared" class="tab">Shared</a>
			<a href="/strategies/mine" class="tab active">My Strategies</a>
		</div>
	</div>

	{#if actionMessage}
		<div class="success">{actionMessage}</div>
	{/if}
	{#if actionError}
		<div class="error">{actionError}</div>
	{/if}

	{#if data.strategies.length === 0}
		<div class="empty">
			<p>You don't have any strategies yet.</p>
			<p>Browse <a href="/strategies/shared">shared strategies</a> to copy one, or upload your own.</p>
		</div>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Name</th>
					<th>File</th>
					<th>Source</th>
				</tr>
			</thead>
			<tbody>
				{#each data.strategies as strategy}
					<tr>
						<td class="name">{strategy.name}</td>
						<td class="mono">{strategy.filename}</td>
						<td>
							{#if strategy.sourceId}
								<span class="source">Copied from shared</span>
							{:else}
								<span class="source private">Private</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<section>
			<h2>Run Backtest</h2>
			<div class="action-row">
				<select bind:value={backtestStrategy}>
					<option value="">Select strategy...</option>
					{#if allStrategies.filter(s => s.source === "user").length > 0}
						<optgroup label="My Strategies">
							{#each allStrategies.filter(s => s.source === "user") as s}
								<option value={s.id}>{s.name}</option>
							{/each}
						</optgroup>
					{/if}
					{#if allStrategies.filter(s => s.source === "shared").length > 0}
						<optgroup label="Shared">
							{#each allStrategies.filter(s => s.source === "shared") as s}
								<option value={s.id}>{s.name}</option>
							{/each}
						</optgroup>
					{/if}
				</select>
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
				<button class="btn-primary" onclick={runBacktest} disabled={!backtestStrategy}>Run</button>
			</div>

			<div class="date-row-inline">
				<span class="date-label">Date range</span>
				<input type="date" bind:value={btFromDate} />
				<span class="date-sep">to</span>
				<input type="date" bind:value={btToDate} />
				<span class="date-sep">|</span>
				<span class="date-label">Balance</span>
				<input type="number" bind:value={btBalance} min="100" step="100" class="balance-input" />
			</div>

			{#if backtestFields.length > 0}
				<div class="strategy-options">
					{#each backtestFields as [key, field] (key)}
						<label>
							<span>{field.label}</span>
							{#if field.type === "number"}
								<input
									type="number"
									value={strategyConfig[key] ?? field.default ?? 0}
									oninput={(e) => { strategyConfig[key] = parseFloat((e.target as HTMLInputElement).value) || 0; }}
									min={field.min}
									step={field.step}
								/>
							{:else}
								<input
									type="text"
									value={strategyConfig[key] ?? field.default ?? ""}
									oninput={(e) => { strategyConfig[key] = (e.target as HTMLInputElement).value; }}
									placeholder={field.placeholder}
								/>
							{/if}
						</label>
					{/each}
				</div>
			{/if}

			<button class="btn-toggle-advanced" onclick={() => showAdvanced = !showAdvanced}>
				{showAdvanced ? "Hide" : "Show"} execution overrides
			</button>

			{#if showAdvanced}
				<div class="advanced-options">
					<div class="option-grid">
						<label>
							<span>Spread multiplier</span>
							<input type="number" bind:value={btSpreadMult} min="0.1" step="0.1" />
						</label>
						<label>
							<span>Slippage (pips)</span>
							<input type="number" bind:value={btSlippage} min="0" step="0.1" />
						</label>
						<label>
							<span>Execution delay (ticks)</span>
							<input type="number" bind:value={btExecDelay} min="0" />
						</label>
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={btTimeVaryingSpread} />
							<span>Time-varying spreads</span>
						</label>
					</div>
					<p class="hint">These override the preset values above.</p>
				</div>
			{/if}

			{#if runningBacktests.length > 0}
				<div class="running-backtests">
					<div class="running-header">
						<h3>Running Backtests</h3>
						{#if runningBacktests.some((b) => b.status !== "running")}
							<button class="btn-clear" onclick={clearFinished}>Clear finished</button>
						{/if}
					</div>
					{#each runningBacktests as bt}
						<div class="bt-row" class:bt-done={bt.status === "done"} class:bt-error={bt.status === "error"}>
							<span class="bt-indicator" class:spinning={bt.status === "running"}>
								{bt.status === "running" ? "⟳" : bt.status === "done" ? "✓" : "✗"}
							</span>
							<span class="bt-name">{bt.strategy}</span>
							<span class="bt-gran">{bt.granularity}</span>
							<span class="bt-output">{bt.lastOutput}</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="hint">Results will appear on the <a href="/backtests">Backtests</a> page when complete.</p>
			{/if}
		</section>

		<section>
			<h2>Start Live Session</h2>
			{#if data.accounts.length === 0}
				<p class="hint">No OANDA accounts found. <a href="/profile">Set your API key</a> first.</p>
			{:else}
				<div class="action-row">
					<select bind:value={liveStrategy}>
						<option value="">Select strategy...</option>
						{#if allStrategies.filter(s => s.source === "user").length > 0}
							<optgroup label="My Strategies">
								{#each allStrategies.filter(s => s.source === "user") as s}
									<option value={s.id}>{s.name}</option>
								{/each}
							</optgroup>
						{/if}
						{#if allStrategies.filter(s => s.source === "shared").length > 0}
							<optgroup label="Shared">
								{#each allStrategies.filter(s => s.source === "shared") as s}
									<option value={s.id}>{s.name}</option>
								{/each}
							</optgroup>
						{/if}
					</select>
					<select bind:value={liveAccountId}>
						<option value="">Select account...</option>
						{#each data.accounts as acct}
							<option value={acct.id}>{acct.alias} ({acct.hedgingEnabled ? "hedging" : "netting"})</option>
						{/each}
					</select>
					<button class="btn-primary" onclick={startLive} disabled={!liveStrategy || !liveAccountId}>Start</button>
				</div>
				{#if liveFields.length > 0}
					<div class="strategy-options">
						{#each liveFields as [key, field] (key)}
							<label>
								<span>{field.label}</span>
								{#if field.type === "number"}
									<input
										type="number"
										value={liveConfig[key] ?? field.default ?? 0}
										oninput={(e) => { liveConfig[key] = parseFloat((e.target as HTMLInputElement).value) || 0; }}
										min={field.min}
										step={field.step}
									/>
								{:else}
									<input
										type="text"
										value={liveConfig[key] ?? field.default ?? ""}
										oninput={(e) => { liveConfig[key] = (e.target as HTMLInputElement).value; }}
										placeholder={field.placeholder}
									/>
								{/if}
							</label>
						{/each}
					</div>
				{/if}
				<p class="hint">Monitor and stop sessions on the <a href="/live">Live</a> page.</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	.strategies-page h1 {
		font-size: 1.4em;
		margin: 0;
	}
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}
	.tabs {
		display: flex;
		gap: 4px;
	}
	.tab {
		padding: 6px 14px;
		border-radius: 6px;
		font-size: 0.9em;
		color: #8b949e;
		background: #0d1117;
		border: 1px solid #21262d;
	}
	.tab:hover { background: #161b22; text-decoration: none; }
	.tab.active {
		background: #161b22;
		color: #c9d1d9;
		border-color: #58a6ff;
	}
	.empty {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 40px;
		text-align: center;
		color: #8b949e;
	}
	.empty p { margin: 4px 0; }
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9em;
	}
	th {
		text-align: left;
		padding: 8px 12px;
		color: #8b949e;
		border-bottom: 2px solid #21262d;
	}
	td {
		padding: 8px 12px;
		border-bottom: 1px solid #21262d;
	}
	tr:hover td { background: #1c2128; }
	.name { font-weight: 600; }
	.mono { font-family: monospace; font-size: 0.85em; color: #8b949e; }
	.source { color: #8b949e; font-size: 0.85em; }
	.source.private { color: #58a6ff; }
	h2 {
		font-size: 1.1em;
		color: #8b949e;
		border-bottom: 1px solid #21262d;
		padding-bottom: 6px;
		margin: 28px 0 12px;
	}
	.action-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	select {
		padding: 8px 12px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.9em;
	}
	select:focus, input:focus {
		outline: none;
		border-color: #58a6ff;
	}
	.btn-primary {
		padding: 8px 16px;
		background: #238636;
		color: #fff;
		border: none;
		border-radius: 4px;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.9em;
	}
	.btn-primary:hover { background: #2ea043; }
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-toggle-advanced {
		background: none;
		border: none;
		color: #58a6ff;
		cursor: pointer;
		font-size: 0.85em;
		padding: 4px 0;
		margin-top: 8px;
	}
	.btn-toggle-advanced:hover { text-decoration: underline; }
	.advanced-options {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 6px;
		padding: 16px;
		margin-top: 8px;
	}
	.option-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.option-grid label {
		display: block;
	}
	.option-grid label span {
		display: block;
		font-size: 0.82em;
		color: #8b949e;
		margin-bottom: 4px;
	}
	.option-grid input[type="number"] {
		width: 100%;
		padding: 6px 10px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.85em;
		box-sizing: border-box;
	}
	.option-grid input:focus {
		outline: none;
		border-color: #58a6ff;
	}
	.date-row-inline {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 10px;
	}
	.date-row-inline input {
		padding: 6px 10px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.85em;
	}
	.date-label { color: #8b949e; font-size: 0.85em; }
	.date-sep { color: #8b949e; font-size: 0.85em; }
	.balance-input {
		width: 90px;
		padding: 6px 10px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.85em;
	}
	.strategy-options {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		margin-top: 10px;
	}
	.strategy-options label span {
		display: block;
		font-size: 0.82em;
		color: #8b949e;
		margin-bottom: 4px;
	}
	.strategy-options input {
		padding: 6px 10px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.85em;
		width: 100%;
		box-sizing: border-box;
	}
	.checkbox-label {
		display: flex !important;
		flex-direction: row !important;
		align-items: center;
		gap: 6px;
	}
	.checkbox-label input[type="checkbox"] {
		width: auto;
	}
	.checkbox-label span {
		margin-bottom: 0 !important;
	}
	.hint {
		color: #8b949e;
		font-size: 0.85em;
		margin-top: 8px;
	}
	.success {
		background: #0d2818;
		color: #3fb950;
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 0.85em;
		margin-bottom: 16px;
	}
	.error {
		background: #5d1a1a;
		color: #f85149;
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 0.85em;
		margin-bottom: 16px;
	}
	.running-backtests {
		margin-top: 12px;
		border: 1px solid #21262d;
		border-radius: 6px;
		overflow: hidden;
	}
	.running-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		background: #161b22;
		border-bottom: 1px solid #21262d;
	}
	.running-header h3 {
		font-size: 0.85em;
		color: #8b949e;
		margin: 0;
	}
	.btn-clear {
		background: none;
		border: none;
		color: #8b949e;
		cursor: pointer;
		font-size: 0.8em;
	}
	.btn-clear:hover { color: #c9d1d9; }
	.bt-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 12px;
		font-size: 0.85em;
		border-bottom: 1px solid #21262d;
	}
	.bt-row:last-child { border-bottom: none; }
	.bt-done { opacity: 0.6; }
	.bt-error .bt-indicator { color: #f85149; }
	.bt-indicator { width: 16px; text-align: center; }
	.bt-indicator.spinning { animation: spin 1s linear infinite; color: #58a6ff; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.bt-name { font-weight: 600; min-width: 120px; }
	.bt-gran { color: #8b949e; min-width: 30px; }
	.bt-output { color: #8b949e; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
