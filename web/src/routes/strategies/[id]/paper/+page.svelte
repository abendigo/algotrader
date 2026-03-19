<script lang="ts">
	import { onMount, onDestroy } from "svelte";

	let { data } = $props();

	interface ConfigFieldDef {
		label: string;
		type: "number" | "text";
		default?: unknown;
		placeholder?: string;
		min?: number;
		step?: number;
	}

	let actionMessage = $state("");
	let actionError = $state("");
	let starting = $state(false);
	let liveAccountId = $state("");
	let liveConfig = $state<Record<string, unknown>>({});

	function getFields(): [string, ConfigFieldDef][] {
		const fields = data.strategy.configFields;
		if (!fields) return [];
		return [
			...Object.entries(fields.common ?? {}),
			...Object.entries(fields.live ?? {}),
		];
	}

	const liveFields = $derived(getFields());

	$effect(() => {
		const newConfig: Record<string, unknown> = {};
		for (const [key, def] of liveFields) {
			newConfig[key] = def.default ?? (def.type === "number" ? 0 : "");
		}
		liveConfig = newConfig;
	});

	async function startLive() {
		if (!liveAccountId) return;
		starting = true;
		actionMessage = "";
		actionError = "";
		const res = await fetch("/api/live/start", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ accountId: liveAccountId, strategy: data.strategy.id, config: liveConfig }),
		});
		const result = await res.json();
		if (res.ok) {
			actionMessage = result.message;
		} else {
			actionError = result.error;
		}
		starting = false;
	}

	// Poll for sessions on this strategy
	interface Session {
		accountId: string;
		accountLabel: string;
		running: boolean;
		stale?: boolean;
		managed?: boolean;
		tickCount?: number;
		strategyName?: string;
		sessionId?: string;
		strategy?: { phase: string; detail?: string; positions: any[]; indicators: any[] };
	}

	let sessions = $state<Session[]>([]);
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let stoppingSessions = $state<Set<string>>(new Set());

	async function fetchSessions() {
		try {
			const res = await fetch("/api/live?type=sessions");
			if (!res.ok) return;
			const all: Session[] = await res.json();
			sessions = all.filter((s) => s.strategyName === data.strategy.id || s.strategyName === data.strategy.name);
		} catch { /* ignore */ }
	}

	onMount(() => { fetchSessions(); pollInterval = setInterval(fetchSessions, 3000); });
	onDestroy(() => { if (pollInterval) clearInterval(pollInterval); });

	async function stopSession(sessionId: string) {
		stoppingSessions.add(sessionId);
		stoppingSessions = new Set(stoppingSessions);
		try {
			await fetch("/api/live/stop", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId }),
			});
		} catch { /* ignore */ }
	}
</script>

<div class="live-tab">
	{#if actionMessage}
		<div class="success">{actionMessage}</div>
	{/if}
	{#if actionError}
		<div class="error">{actionError}</div>
	{/if}

	<section>
		<h2>Start Session</h2>
		{#if data.accounts.length === 0}
			<p class="hint">No OANDA accounts found. <a href="/profile">Set your API key</a> first.</p>
		{:else}
			<div class="action-row">
				<select bind:value={liveAccountId}>
					<option value="">Select account...</option>
					{#each data.accounts as acct}
						<option value={acct.id}>{acct.alias} ({acct.hedgingEnabled ? "hedging" : "netting"})</option>
					{/each}
				</select>
				<button class="btn-primary" onclick={startLive} disabled={!liveAccountId || starting}>{starting ? "Starting..." : "Start"}</button>
			</div>
			{#if liveFields.length > 0}
				<div class="strategy-options">
					{#each liveFields as [key, field] (key)}
						<label>
							<span>{field.label}</span>
							{#if field.type === "number"}
								<input type="number"
									value={liveConfig[key] ?? field.default ?? 0}
									oninput={(e) => { liveConfig[key] = parseFloat((e.target as HTMLInputElement).value) || 0; }}
									min={field.min} step={field.step} />
							{:else}
								<input type="text"
									value={liveConfig[key] ?? field.default ?? ""}
									oninput={(e) => { liveConfig[key] = (e.target as HTMLInputElement).value; }}
									placeholder={field.placeholder} />
							{/if}
						</label>
					{/each}
				</div>
			{/if}
		{/if}
	</section>

	{#if sessions.length > 0}
		<section>
			<h2>Active Sessions</h2>
			{#each sessions as session}
				<div class="session-card">
					<div class="session-header">
						<span class="dot" class:active={session.running && !session.stale}></span>
						<span class="session-account">{session.accountLabel}</span>
						{#if session.running && !session.stale}
							<span class="session-ticks">{session.tickCount?.toLocaleString()} ticks</span>
							{#if session.managed}
								<button class="btn-stop" onclick={() => stopSession(session.sessionId!)}
									disabled={stoppingSessions.has(session.sessionId ?? "")}>
									{stoppingSessions.has(session.sessionId ?? "") ? "Stopping..." : "Stop"}
								</button>
							{/if}
						{:else}
							<span class="muted">Stopped</span>
						{/if}
					</div>
					{#if session.strategy}
						<div class="session-phase">{session.strategy.phase}</div>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	{#if data.pastSessions.length > 0}
		<section>
			<h2>Previous Sessions</h2>
			<table class="past-table">
				<thead>
					<tr>
						<th>Status</th>
						<th>Started</th>
						<th>Duration</th>
						<th>Trades</th>
						<th>W/L</th>
						<th>P&L</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.pastSessions as ps}
						{@const started = new Date(ps.startedAt)}
						{@const last = new Date(ps.lastHeartbeat)}
						{@const durMs = last.getTime() - started.getTime()}
						{@const durMin = Math.round(durMs / 60000)}
						<tr>
							<td>
								<span class="status-badge" class:running={ps.status === "running"} class:stopped={ps.status === "stopped"} class:error={ps.status === "error"}>
									{ps.status}
								</span>
							</td>
							<td>{started.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
							<td class="muted">{durMin < 60 ? `${durMin}m` : `${Math.floor(durMin / 60)}h ${durMin % 60}m`}</td>
							<td>{ps.trades}</td>
							<td>{ps.winners}W / {ps.losers}L</td>
							<td class:pos={ps.totalPnl > 0} class:neg={ps.totalPnl < 0}>{ps.totalPnl >= 0 ? "+" : ""}{ps.totalPnl.toFixed(2)}</td>
							<td class="report-links">
								{#if ps.trades > 0}
									<a href="/api/live/report?session={ps.sessionId}&format=html" target="_blank">HTML</a>
									<a href="/api/live/report?session={ps.sessionId}&format=csv">CSV</a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}
</div>

<style>
	h2 { font-size: 1em; color: #8b949e; border-bottom: 1px solid #21262d; padding-bottom: 6px; margin: 0 0 12px; }
	section { margin-bottom: 24px; }
	.success { background: #0d2818; color: #3fb950; padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 12px; }
	.error { background: #5d1a1a; color: #f85149; padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 12px; }
	.hint { color: #8b949e; font-size: 0.85em; }
	.action-row { display: flex; gap: 8px; align-items: center; }
	select, input { padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85em; }
	select:focus, input:focus { outline: none; border-color: #58a6ff; }
	.btn-primary { padding: 6px 16px; background: #238636; color: #fff; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.85em; }
	.btn-primary:hover { background: #2ea043; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.strategy-options { display: flex; gap: 12px; align-items: flex-end; margin-top: 10px; }
	.strategy-options label span { display: block; font-size: 0.82em; color: #8b949e; margin-bottom: 4px; }
	.strategy-options input { width: 100%; box-sizing: border-box; }
	.muted { color: #8b949e; }
	.session-card { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; }
	.session-header { display: flex; align-items: center; gap: 10px; font-size: 0.9em; }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: #8b949e; flex-shrink: 0; }
	.dot.active { background: #3fb950; }
	.session-account { font-weight: 600; }
	.session-ticks { color: #8b949e; font-size: 0.85em; }
	.btn-stop { margin-left: auto; padding: 3px 10px; background: transparent; color: #f85149; border: 1px solid #f85149; border-radius: 4px; cursor: pointer; font-size: 0.85em; }
	.btn-stop:hover { background: #5d1a1a; }
	.btn-stop:disabled { opacity: 0.5; cursor: not-allowed; }
	.session-phase { color: #8b949e; font-size: 0.85em; margin-top: 6px; }
	.past-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
	.past-table th { text-align: left; padding: 6px 10px; color: #8b949e; border-bottom: 2px solid #21262d; }
	.past-table td { padding: 6px 10px; border-bottom: 1px solid #21262d; }
	.past-table tr:hover td { background: #1c2128; }
	.status-badge { padding: 1px 6px; border-radius: 3px; font-size: 0.8em; font-weight: 600; text-transform: uppercase; }
	.status-badge.running { background: #0d419d; color: #58a6ff; }
	.status-badge.stopped { background: #21262d; color: #8b949e; }
	.status-badge.error { background: #5d1a1a; color: #f85149; }
	.pos { color: #3fb950; }
	.neg { color: #f85149; }
	.report-links { display: flex; gap: 8px; }
	.report-links a { font-size: 0.85em; color: #58a6ff; }
</style>
