<script lang="ts">
	import { onMount, onDestroy } from "svelte";

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
	let sessionPollInterval: ReturnType<typeof setInterval> | null = null;

	const activeSessions = $derived(sessions.filter((s) => s.running && !s.stale));
	const totalTicks = $derived(sessions.reduce((sum, s) => sum + (s.tickCount ?? 0), 0));

	onMount(() => {
		// Poll sessions every 2 seconds
		const fetchSessions = async () => {
			try {
				const res = await fetch("/api/live?type=sessions");
				if (!res.ok) return;
				const allSessions: Session[] = await res.json();

				// Fetch trade logs for each session (filtered by sessionId if available)
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

				sessions = allSessions;
			} catch {
				// ignore
			}
		};
		fetchSessions();
		sessionPollInterval = setInterval(fetchSessions, 2000);
	});

	onDestroy(() => {
		if (sessionPollInterval) clearInterval(sessionPollInterval);
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
				No active strategy sessions — start one from the <a href="/strategies/mine">Strategies</a> page
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
		color: #8b949e;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.active-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #3fb950;
	}
	h2 {
		font-size: 1.1em;
		color: #8b949e;
		border-bottom: 1px solid #21262d;
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
		color: #8b949e;
		border-bottom: 2px solid #21262d;
	}
	td {
		padding: 8px 12px;
		border-bottom: 1px solid #21262d;
	}
	tr:hover td {
		background: #1c2128;
	}
	.instrument {
		font-weight: 600;
	}
	.price {
		font-variant-numeric: tabular-nums;
	}
	.pos { color: #3fb950; }
	.neg { color: #f85149; }
	.muted { color: #8b949e; }
	.badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 0.8em;
		font-weight: 600;
	}
	.badge.buy { background: #0d419d; color: #58a6ff; }
	.badge.sell { background: #5d1a1a; color: #f85149; }
	.badge.warn { background: #5d3a00; color: #d29922; }
	h3 {
		font-size: 0.95em;
		color: #8b949e;
		margin: 16px 0 8px;
	}
	.strategy-session {
		background: #0d1117;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 0 16px 16px;
		margin-bottom: 16px;
	}
	.session-account {
		font-size: 0.8em;
		font-weight: 400;
		color: #58a6ff;
		margin-left: 8px;
	}
	.runner-status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.9em;
		color: #8b949e;
		margin-bottom: 12px;
	}
	.runner-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #8b949e;
	}
	.runner-dot.active { background: #3fb950; }
	.btn-stop {
		margin-left: auto;
		padding: 3px 10px;
		background: transparent;
		color: #f85149;
		border: 1px solid #f85149;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85em;
	}
	.btn-stop:hover { background: #5d1a1a; }
	.btn-stop:disabled { opacity: 0.5; cursor: not-allowed; }
	.strategy-phase {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
		padding: 8px 12px;
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 6px;
	}
	.phase-label {
		font-weight: 600;
		font-size: 0.9em;
	}
	.phase-detail {
		color: #8b949e;
		font-size: 0.82em;
	}
	.indicator-value {
		font-family: monospace;
		font-size: 0.82em;
		color: #8b949e;
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
		border: 1px solid #21262d;
		border-radius: 6px;
	}
	.log-entry {
		display: flex;
		gap: 10px;
		padding: 6px 12px;
		border-bottom: 1px solid #21262d;
		font-size: 0.82em;
	}
	.log-entry:last-child { border-bottom: none; }
	.log-entry.trade { background: #0d2818; }
	.log-entry.exit { background: #1a1000; }
	.log-time {
		color: #8b949e;
		font-variant-numeric: tabular-nums;
		min-width: 65px;
	}
	.log-type {
		font-weight: 600;
		min-width: 55px;
	}
	.log-entry.trade .log-type { color: #3fb950; }
	.log-entry.exit .log-type { color: #d29922; }
	.log-entry.status .log-type { color: #8b949e; }
	.log-message { color: #c9d1d9; }
</style>
