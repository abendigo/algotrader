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

	import { invalidateAll } from "$app/navigation";

	let actionMessage = $state("");
	let actionError = $state("");
	let starting = $state(false);
	let liveAccountId = $state("");
	let deleteTarget = $state<string | null>(null);
	let expanded = $state<Set<string>>(new Set());

	function toggleSession(sessionId: string) {
		if (expanded.has(sessionId)) expanded.delete(sessionId);
		else expanded.add(sessionId);
		expanded = new Set(expanded);
	}
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

	function rerunSession(ps: typeof filteredPastSessions[0]) {
		liveAccountId = ps.accountId;
		if (ps.config && typeof ps.config === "object") {
			liveConfig = { ...liveConfig, ...ps.config };
		}
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	async function deleteSession() {
		if (!deleteTarget) return;
		const res = await fetch(`/api/live/session?id=${deleteTarget}`, { method: "DELETE" });
		if (res.ok) {
			deleteTarget = null;
			await invalidateAll();
		}
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
	let prevActiveIds = new Set<string>();

	async function fetchSessions() {
		try {
			const res = await fetch("/api/live?type=sessions");
			if (!res.ok) return;
			const all: Session[] = await res.json();
			sessions = all.filter((s) => s.strategyName === data.strategy.id || s.strategyName === data.strategy.name);

			// If a session that was active is now gone or stopped, refresh past sessions
			const currentActiveIds = new Set(sessions.filter((s) => s.running && !s.stale).map((s) => s.sessionId ?? ""));
			for (const id of prevActiveIds) {
				if (!currentActiveIds.has(id)) {
					await invalidateAll();
					break;
				}
			}
			prevActiveIds = currentActiveIds;
		} catch { /* ignore */ }
	}

	onMount(() => { fetchSessions(); pollInterval = setInterval(fetchSessions, 3000); });
	onDestroy(() => { if (pollInterval) clearInterval(pollInterval); });

	// Filter past sessions to exclude ones currently active
	const activeSessionIds = $derived(new Set(sessions.map((s) => s.sessionId)));
	const filteredPastSessions = $derived(data.pastSessions.filter((ps: any) => !activeSessionIds.has(ps.sessionId)));

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

	{#if filteredPastSessions.length > 0}
		<section>
			<h2>Previous Sessions</h2>
			<table class="past-table">
				<thead>
					<tr>
						<th></th>
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
					{#each filteredPastSessions as ps}
						{@const started = new Date(ps.startedAt)}
						{@const last = new Date(ps.lastHeartbeat)}
						{@const durMs = last.getTime() - started.getTime()}
						{@const durMin = Math.round(durMs / 60000)}
						{@const isOpen = expanded.has(ps.sessionId)}
						<tr class="summary-row" onclick={() => toggleSession(ps.sessionId)}>
							<td class="chevron">{isOpen ? "▾" : "▸"}</td>
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
							<td class="report-links" onclick={(e) => e.stopPropagation()}>
								<button class="btn-link" onclick={() => rerunSession(ps)}>Rerun</button>
								{#if ps.trades > 0}
									<a href="/api/live/report?session={ps.sessionId}&format=html" target="_blank">HTML</a>
									<a href="/api/live/report?session={ps.sessionId}&format=csv">CSV</a>
								{/if}
								<button class="btn-link" disabled title="Coming soon">Share</button>
								<button class="btn-link btn-delete" onclick={() => deleteTarget = ps.sessionId}>Delete</button>
							</td>
						</tr>
						{#if isOpen}
							<tr class="detail-row">
								<td colspan="8">
									<div class="detail-panel">
										<div class="detail-section">
											<h4>Session</h4>
											<div class="detail-grid">
												<span class="dl">Account</span><span class="dv">{ps.accountId}</span>
												<span class="dl">Started</span><span class="dv">{started.toISOString().slice(0, 19).replace("T", " ")}</span>
												<span class="dl">Ended</span><span class="dv">{last.toISOString().slice(0, 19).replace("T", " ")}</span>
												<span class="dl">Duration</span><span class="dv">{durMin < 60 ? `${durMin}m` : `${Math.floor(durMin / 60)}h ${durMin % 60}m`}</span>
												{#if ps.lastError}
													<span class="dl">Error</span><span class="dv error-text">{ps.lastError}</span>
												{/if}
											</div>
										</div>
										{#if ps.config && Object.keys(ps.config).length > 0}
											<div class="detail-section">
												<h4>Parameters</h4>
												<div class="detail-grid">
													{#each Object.entries(ps.config).filter(([, v]) => v != null && v !== 0 && v !== "") as [key, val]}
														<span class="dl">{key}</span>
														<span class="dv">{Array.isArray(val) ? val.join(", ") : val}</span>
													{/each}
												</div>
											</div>
										{/if}
										<div class="detail-section">
											<h4>Results</h4>
											<div class="detail-grid">
												<span class="dl">Trades</span><span class="dv">{ps.trades}</span>
												<span class="dl">Winners</span><span class="dv pos">{ps.winners}</span>
												<span class="dl">Losers</span><span class="dv neg">{ps.losers}</span>
												<span class="dl">P&L</span><span class="dv" class:pos={ps.totalPnl > 0} class:neg={ps.totalPnl < 0}>{ps.totalPnl >= 0 ? "+" : ""}{ps.totalPnl.toFixed(2)}</span>
											</div>
										</div>
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
				<h3>Delete session?</h3>
				<p class="modal-warning">This will remove the session record. Trade data in trades.jsonl is preserved.</p>
				<div class="modal-actions">
					<button class="btn-action" onclick={() => deleteTarget = null}>Cancel</button>
					<button class="btn-primary btn-danger" onclick={deleteSession}>Delete</button>
				</div>
			</div>
		</div>
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
	.summary-row { cursor: pointer; }
	.summary-row:hover td { background: #1c2128; }
	.chevron { color: #8b949e; width: 16px; font-size: 0.8em; }
	.detail-row td { padding: 0; border-bottom: 2px solid #21262d; }
	.detail-panel { display: flex; gap: 32px; padding: 12px 16px 12px 32px; background: #161b22; }
	.detail-section h4 { font-size: 0.8em; color: #8b949e; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.05em; }
	.detail-grid { display: grid; grid-template-columns: auto auto; gap: 2px 12px; font-size: 0.9em; }
	.dl { color: #8b949e; }
	.dv { color: #c9d1d9; }
	.error-text { color: #f85149; }
	.report-links { display: flex; gap: 8px; }
	.report-links a { font-size: 0.85em; color: #58a6ff; }
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
</style>
