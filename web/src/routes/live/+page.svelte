<script lang="ts">
	import { onMount } from "svelte";
	import { connectSSE } from "$lib/sse.js";

	interface Indicator {
		label: string;
		instrument?: string;
		value: string;
		signal?: "buy" | "sell" | "neutral" | "warn";
	}

	interface StrategyPosition {
		instrument: string;
		side: "buy" | "sell";
		entryPrice: number;
		pnl?: number;
		detail?: string;
	}

	interface StrategyState {
		phase: string;
		detail?: string;
		indicators: Indicator[];
		positions: StrategyPosition[];
	}

	interface Session {
		accountId: string;
		accountLabel: string;
		running: boolean;
		stale?: boolean;
		managed?: boolean;
		tickCount?: number;
		timestamp?: string;
		strategyName?: string;
		sessionId?: string;
		sessionStatus?: string;
		strategy?: StrategyState;
		tradeLog?: TradeLog[];
	}

	interface TradeLog {
		timestamp: string;
		type: string;
		message: string;
	}

	let sessions = $state<Session[]>([]);

	const activeSessions = $derived(sessions.filter((s) => s.running && !s.stale));
	const totalTicks = $derived(sessions.reduce((sum, s) => sum + (s.tickCount ?? 0), 0));

	async function fetchTradeLogs(allSessions: Session[]): Promise<void> {
		await Promise.all(
			allSessions.map(async (s) => {
				try {
					let logUrl = `/api/live?type=log&account=${s.accountId}`;
					if (s.sessionId) logUrl += `&sessionId=${s.sessionId}`;
					const logRes = await fetch(logUrl);
					if (logRes.ok) s.tradeLog = await logRes.json();
				} catch { /* ignore */ }
			})
		);
	}

	onMount(() => {
		// Initial fetch via REST (SSE may take a moment to connect)
		fetch("/api/live?type=sessions").then(async (res) => {
			if (!res.ok) return;
			const all: Session[] = await res.json();
			await fetchTradeLogs(all);
			sessions = all;
		}).catch(() => {});

		return connectSSE("/api/live/stream", async (data) => {
			if (data.sessions) {
				const all: Session[] = data.sessions;
				await fetchTradeLogs(all);
				sessions = all;
			}
		});
	});

	let stoppingSessions = $state<Set<string>>(new Set());

	async function stopSession(sessionId: string) {
		stoppingSessions.add(sessionId);
		stoppingSessions = new Set(stoppingSessions);

		try {
			await fetch("/api/live/stop", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId }),
			});
		} catch {
			// ignore
		}
	}

	function formatPrice(price: number, instrument: string): string {
		const decimals = instrument.includes("JPY") ? 3 : 5;
		return price.toFixed(decimals);
	}
</script>

<div class="live-page">
	<div class="header-row">
		<h1>Live Trading</h1>
		<div class="summary">
			{#if activeSessions.length > 0}
				<span class="active-dot"></span>
				{activeSessions.length} active session{activeSessions.length !== 1 ? "s" : ""}
				<span class="muted">| {totalTicks.toLocaleString()} ticks</span>
			{:else}
				<span class="muted">No active sessions</span>
			{/if}
		</div>
	</div>

	{#if sessions.length > 0}
		{#each sessions as session}
			<section class="strategy-session">
				<h2>
					{session.strategyName ?? "Strategy"}
					<span class="session-account">{session.accountLabel}</span>
				</h2>

				<div class="runner-status">
					<span class="runner-dot" class:active={session.running && !session.stale}></span>
					{#if session.running && !session.stale}
						Runner active | {session.tickCount?.toLocaleString()} ticks
						{#if session.managed}
							<button
								class="btn-stop"
								onclick={() => stopSession(session.sessionId!)}
								disabled={stoppingSessions.has(session.sessionId ?? "")}
							>
								{stoppingSessions.has(session.sessionId ?? "") ? "Stopping..." : "Stop"}
							</button>
						{/if}
					{:else if session.stale}
						Runner stale (last update: {session.timestamp?.slice(11, 19)})
					{:else}
						Runner not active
					{/if}
				</div>

				{#if session.strategy}
					<div class="strategy-phase">
						<span class="phase-label">{session.strategy.phase}</span>
						{#if session.strategy.detail}
							<span class="phase-detail">{session.strategy.detail}</span>
						{/if}
					</div>

					{#if session.strategy.indicators?.length > 0}
						<h3>Indicators</h3>
						<table class="compact indicators-table">
							<thead>
								<tr>
									<th>Pair</th>
									<th>Signal</th>
									<th>Details</th>
								</tr>
							</thead>
							<tbody>
								{#each session.strategy.indicators as ind}
									<tr>
										<td class="instrument">{ind.label}</td>
										<td>
											{#if ind.signal === "buy"}
												<span class="badge buy">BUY</span>
											{:else if ind.signal === "sell"}
												<span class="badge sell">SELL</span>
											{:else if ind.signal === "warn"}
												<span class="badge warn">EXIT?</span>
											{:else}
												<span class="muted">—</span>
											{/if}
										</td>
										<td class="indicator-value">{ind.value}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}

					{#if session.strategy.positions?.length > 0}
						<h3>Strategy Positions</h3>
						<table class="compact">
							<thead>
								<tr>
									<th>Instrument</th>
									<th>Side</th>
									<th>Entry</th>
									<th>PnL</th>
									<th>Detail</th>
								</tr>
							</thead>
							<tbody>
								{#each session.strategy.positions as sp}
									<tr>
										<td class="instrument">{sp.instrument.replace("_", "/")}</td>
										<td><span class="badge" class:buy={sp.side === "buy"} class:sell={sp.side === "sell"}>{sp.side.toUpperCase()}</span></td>
										<td class="price">{sp.entryPrice > 0 ? formatPrice(sp.entryPrice, sp.instrument) : "—"}</td>
										<td class:pos={(sp.pnl ?? 0) > 0} class:neg={(sp.pnl ?? 0) < 0}>{sp.pnl != null ? sp.pnl.toFixed(5) : "—"}</td>
										<td class="muted">{sp.detail ?? ""}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				{/if}

				{#if session.tradeLog && session.tradeLog.length > 0}
					<h3>Today's Activity</h3>
					<div class="trade-log">
						{#each [...session.tradeLog].reverse() as entry}
							<div class="log-entry" class:trade={entry.type === "trade"} class:exit={entry.type === "exit"} class:status={entry.type === "status"}>
								<span class="log-time">{entry.timestamp.slice(11, 19)}</span>
								<span class="log-type">{entry.type.toUpperCase()}</span>
								<span class="log-message">{entry.message}</span>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/each}
	{:else}
		<section>
			<div class="runner-status">
				<span class="runner-dot"></span>
				No active strategy sessions — start one from the <a href="/strategies">Strategies</a> page
			</div>
		</section>
	{/if}
</div>

<style>
	.live-page h1 {
		font-size: 1.4em;
		margin: 0;
	}
	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}
	.summary {
		font-size: 0.85em;
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.active-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success);
	}
	h2 {
		font-size: 1.1em;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border);
		padding-bottom: 6px;
		margin: 20px 0 12px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88em;
	}
	th {
		text-align: left;
		padding: 8px 12px;
		color: var(--text-secondary);
		border-bottom: 2px solid var(--border);
	}
	td {
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
	}
	tr:hover td {
		background: var(--bg-hover);
	}
	.instrument {
		font-weight: 600;
	}
	.price {
		font-variant-numeric: tabular-nums;
	}
	.pos { color: var(--success); }
	.neg { color: var(--danger); }
	.muted { color: var(--text-secondary); }
	.badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 0.8em;
		font-weight: 600;
	}
	.badge.buy { background: var(--badge-buy-bg); color: var(--accent); }
	.badge.sell { background: var(--danger-bg); color: var(--danger); }
	.badge.warn { background: var(--badge-warn-bg); color: var(--warning); }
	h3 {
		font-size: 0.95em;
		color: var(--text-secondary);
		margin: 16px 0 8px;
	}
	.strategy-session {
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0 16px 16px;
		margin-bottom: 16px;
	}
	.session-account {
		font-size: 0.8em;
		font-weight: 400;
		color: var(--accent);
		margin-left: 8px;
	}
	.runner-status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.9em;
		color: var(--text-secondary);
		margin-bottom: 12px;
	}
	.runner-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-secondary);
	}
	.runner-dot.active { background: var(--success); }
	.btn-stop {
		margin-left: auto;
		padding: 3px 10px;
		background: transparent;
		color: var(--danger);
		border: 1px solid var(--danger);
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85em;
	}
	.btn-stop:hover { background: var(--danger-bg); }
	.btn-stop:disabled { opacity: 0.5; cursor: not-allowed; }
	.strategy-phase {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
		padding: 8px 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.phase-label {
		font-weight: 600;
		font-size: 0.9em;
	}
	.phase-detail {
		color: var(--text-secondary);
		font-size: 0.82em;
	}
	.indicator-value {
		font-family: monospace;
		font-size: 0.82em;
		color: var(--text-secondary);
	}
.compact {
		font-size: 0.85em;
	}
	.compact th, .compact td {
		padding: 5px 8px;
	}
	.trade-log {
		max-height: 300px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.log-entry {
		display: flex;
		gap: 10px;
		padding: 6px 12px;
		border-bottom: 1px solid var(--border);
		font-size: 0.82em;
	}
	.log-entry:last-child { border-bottom: none; }
	.log-entry.trade { background: var(--success-bg); }
	.log-entry.exit { background: var(--warning-bg); }
	.log-time {
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
		min-width: 65px;
	}
	.log-type {
		font-weight: 600;
		min-width: 55px;
	}
	.log-entry.trade .log-type { color: var(--success); }
	.log-entry.exit .log-type { color: var(--warning); }
	.log-entry.status .log-type { color: var(--text-secondary); }
	.log-message { color: var(--text-primary); }
</style>
