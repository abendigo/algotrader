<script lang="ts">
	import { onMount, onDestroy } from "svelte";

	interface Price {
		instrument: string;
		bid: number;
		ask: number;
		spread: number;
		timestamp: number;
		change?: number;
	}

	interface Account {
		balance: number;
		equity: number;
		unrealizedPL: number;
		realizedPL: number;
		currency: string;
		openPositions: number;
		openTrades: number;
		marginUsed: number;
		marginAvailable: number;
	}

	interface Position {
		instrument: string;
		side: "buy" | "sell";
		units: number;
		avgPrice: number;
		unrealizedPL: number;
	}

	interface StrategyState {
		running: boolean;
		stale?: boolean;
		tickCount?: number;
		timestamp?: string;
		strategy?: {
			date: string;
			rangesLocked: boolean;
			asianRanges: { instrument: string; high: number; low: number; range: number }[];
			openPositions: { instrument: string; side: string; entryPrice: number; stopLoss: number; pnl: number; peakPnl: number; trailingActive: boolean }[];
		};
	}

	interface TradeLog {
		timestamp: string;
		type: string;
		message: string;
	}

	let prices = $state<Map<string, Price>>(new Map());
	let prevPrices = $state<Map<string, number>>(new Map());
	let account = $state<Account | null>(null);
	let positions = $state<Position[]>([]);
	let strategyState = $state<StrategyState | null>(null);
	let tradeLog = $state<TradeLog[]>([]);
	let connected = $state(false);
	let tickCount = $state(0);
	let lastTickTime = $state("");
	let eventSource: EventSource | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let statePollInterval: ReturnType<typeof setInterval> | null = null;

	const INSTRUMENTS = [
		"EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "AUD_USD", "NZD_USD",
	];

	function getLondonTime(): string {
		return new Intl.DateTimeFormat("en-GB", {
			timeZone: "Europe/London",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(new Date());
	}

	function getSessionPhase(): { phase: string; color: string } {
		const now = new Date();
		const london = new Intl.DateTimeFormat("en-US", {
			timeZone: "Europe/London",
			hour: "numeric",
			minute: "numeric",
			hour12: false,
		}).formatToParts(now);
		const hour = parseInt(london.find((p) => p.type === "hour")!.value);
		const min = parseInt(london.find((p) => p.type === "minute")!.value);
		const londonMin = hour * 60 + min;

		if (londonMin < 420) return { phase: "Asian Session (tracking range)", color: "#8b949e" };
		if (londonMin < 480) return { phase: "Pre-London (ranges locked)", color: "#d29922" };
		if (londonMin < 720) return { phase: "London Open (entry window)", color: "#3fb950" };
		if (londonMin < 960) return { phase: "London Session (holding)", color: "#58a6ff" };
		return { phase: "Post-Session (closed)", color: "#8b949e" };
	}

	let londonTime = $state(getLondonTime());
	let sessionPhase = $state(getSessionPhase());
	let clockInterval: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		// Start SSE price stream
		eventSource = new EventSource("/api/prices/stream");
		eventSource.onmessage = (event) => {
			const tick = JSON.parse(event.data);
			if (tick.error) {
				console.error("Stream error:", tick.error);
				return;
			}
			connected = true;
			tickCount++;
			lastTickTime = new Date(tick.timestamp).toISOString().slice(11, 19);

			const prev = prices.get(tick.instrument);
			if (prev) {
				prevPrices.set(tick.instrument, (prev.bid + prev.ask) / 2);
			}

			const mid = (tick.bid + tick.ask) / 2;
			const prevMid = prevPrices.get(tick.instrument);
			prices.set(tick.instrument, {
				...tick,
				change: prevMid ? mid - prevMid : 0,
			});
			// Trigger reactivity
			prices = new Map(prices);
		};
		eventSource.onerror = () => {
			connected = false;
		};

		// Poll account and positions every 5 seconds
		const fetchAccountData = async () => {
			try {
				const [acctRes, posRes] = await Promise.all([
					fetch("/api/account"),
					fetch("/api/positions"),
				]);
				if (acctRes.ok) account = await acctRes.json();
				if (posRes.ok) positions = await posRes.json();
			} catch {
				// ignore
			}
		};
		fetchAccountData();
		pollInterval = setInterval(fetchAccountData, 5000);

		// Poll strategy state and trade log every 2 seconds
		const fetchStrategyData = async () => {
			try {
				const [stateRes, logRes] = await Promise.all([
					fetch("/api/live?type=state"),
					fetch("/api/live?type=log"),
				]);
				if (stateRes.ok) strategyState = await stateRes.json();
				if (logRes.ok) tradeLog = await logRes.json();
			} catch {
				// ignore
			}
		};
		fetchStrategyData();
		statePollInterval = setInterval(fetchStrategyData, 2000);

		// Update clock every second
		clockInterval = setInterval(() => {
			londonTime = getLondonTime();
			sessionPhase = getSessionPhase();
		}, 1000);
	});

	onDestroy(() => {
		eventSource?.close();
		if (pollInterval) clearInterval(pollInterval);
		if (statePollInterval) clearInterval(statePollInterval);
		if (clockInterval) clearInterval(clockInterval);
	});

	function formatPrice(price: number, instrument: string): string {
		const decimals = instrument.includes("JPY") ? 3 : 5;
		return price.toFixed(decimals);
	}
</script>

<div class="live-page">
	<div class="header-row">
		<h1>Live Trading</h1>
		<div class="status">
			<span class="dot" class:connected></span>
			{connected ? "Connected" : "Disconnected"}
			{#if tickCount > 0}
				<span class="muted">| {tickCount} ticks | {lastTickTime} UTC</span>
			{/if}
		</div>
	</div>

	<div class="session-bar" style="border-left-color: {sessionPhase.color}">
		<span class="session-label" style="color: {sessionPhase.color}">{sessionPhase.phase}</span>
		<span class="london-clock">{londonTime} London</span>
	</div>

	{#if account}
		<section>
			<h2>Account</h2>
			<div class="cards">
				<div class="card">
					<div class="label">Balance</div>
					<div class="value">${account.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
				</div>
				<div class="card">
					<div class="label">Equity</div>
					<div class="value">${account.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
				</div>
				<div class="card">
					<div class="label">Unrealized PnL</div>
					<div class="value" class:pos={account.unrealizedPL > 0} class:neg={account.unrealizedPL < 0}>
						${account.unrealizedPL.toFixed(2)}
					</div>
				</div>
				<div class="card">
					<div class="label">Open Trades</div>
					<div class="value">{account.openTrades}</div>
				</div>
				<div class="card">
					<div class="label">Margin Used</div>
					<div class="value">${account.marginUsed.toFixed(2)}</div>
				</div>
				<div class="card">
					<div class="label">Margin Available</div>
					<div class="value">${account.marginAvailable.toFixed(2)}</div>
				</div>
			</div>
		</section>
	{/if}

	<section>
		<h2>Live Prices</h2>
		<table>
			<thead>
				<tr>
					<th>Instrument</th>
					<th>Bid</th>
					<th>Ask</th>
					<th>Spread</th>
					<th>Change</th>
				</tr>
			</thead>
			<tbody>
				{#each INSTRUMENTS as inst}
					{@const p = prices.get(inst)}
					<tr>
						<td class="instrument">{inst.replace("_", "/")}</td>
						{#if p}
							<td class="price">{formatPrice(p.bid, inst)}</td>
							<td class="price">{formatPrice(p.ask, inst)}</td>
							<td class="spread">{formatPrice(p.spread, inst)}</td>
							<td class:pos={p.change && p.change > 0} class:neg={p.change && p.change < 0}>
								{p.change && p.change > 0 ? "+" : ""}{p.change ? formatPrice(p.change, inst) : "—"}
							</td>
						{:else}
							<td colspan="4" class="muted">Waiting...</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	{#if positions.length > 0}
		<section>
			<h2>Open Positions</h2>
			<table>
				<thead>
					<tr>
						<th>Instrument</th>
						<th>Side</th>
						<th>Units</th>
						<th>Avg Price</th>
						<th>Current</th>
						<th>PnL</th>
					</tr>
				</thead>
				<tbody>
					{#each positions as pos}
						{@const currentPrice = prices.get(pos.instrument)}
						<tr>
							<td class="instrument">{pos.instrument.replace("_", "/")}</td>
							<td><span class="badge" class:buy={pos.side === "buy"} class:sell={pos.side === "sell"}>{pos.side.toUpperCase()}</span></td>
							<td>{pos.units.toLocaleString()}</td>
							<td class="price">{formatPrice(pos.avgPrice, pos.instrument)}</td>
							<td class="price">
								{#if currentPrice}
									{formatPrice(pos.side === "buy" ? currentPrice.bid : currentPrice.ask, pos.instrument)}
								{:else}
									—
								{/if}
							</td>
							<td class:pos={pos.unrealizedPL > 0} class:neg={pos.unrealizedPL < 0}>
								${pos.unrealizedPL.toFixed(2)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	<section>
		<h2>Strategy: London Breakout</h2>
		{#if strategyState?.strategy}
			{@const strat = strategyState.strategy}
			<div class="runner-status">
				<span class="runner-dot" class:active={strategyState.running && !strategyState.stale}></span>
				{#if strategyState.running && !strategyState.stale}
					Runner active | {strategyState.tickCount?.toLocaleString()} ticks
				{:else if strategyState.stale}
					Runner stale (last update: {strategyState.timestamp?.slice(11, 19)})
				{:else}
					Runner not active
				{/if}
			</div>

			{#if strat.asianRanges.length > 0}
				<h3>Asian Ranges {strat.rangesLocked ? "(locked)" : "(tracking...)"}</h3>
				<table class="compact">
					<thead>
						<tr>
							<th>Instrument</th>
							<th>High</th>
							<th>Low</th>
							<th>Range</th>
							<th>Current</th>
							<th>vs Range</th>
						</tr>
					</thead>
					<tbody>
						{#each strat.asianRanges as ar}
							{@const currentPrice = prices.get(ar.instrument)}
							{@const mid = currentPrice ? (currentPrice.bid + currentPrice.ask) / 2 : 0}
							{@const aboveHigh = mid > ar.high}
							{@const belowLow = mid > 0 && mid < ar.low}
							<tr>
								<td class="instrument">{ar.instrument.replace("_", "/")}</td>
								<td class="price">{formatPrice(ar.high, ar.instrument)}</td>
								<td class="price">{formatPrice(ar.low, ar.instrument)}</td>
								<td class="price">{formatPrice(ar.range, ar.instrument)}</td>
								<td class="price">
									{#if currentPrice}
										{formatPrice(mid, ar.instrument)}
									{:else}
										—
									{/if}
								</td>
								<td>
									{#if aboveHigh}
										<span class="pos">Above high</span>
									{:else if belowLow}
										<span class="neg">Below low</span>
									{:else if mid > 0}
										<span class="muted">In range</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			{#if strat.openPositions.length > 0}
				<h3>Strategy Positions</h3>
				<table class="compact">
					<thead>
						<tr>
							<th>Instrument</th>
							<th>Side</th>
							<th>Entry</th>
							<th>Stop</th>
							<th>PnL</th>
							<th>Peak PnL</th>
							<th>Trail</th>
						</tr>
					</thead>
					<tbody>
						{#each strat.openPositions as sp}
							<tr>
								<td class="instrument">{sp.instrument.replace("_", "/")}</td>
								<td><span class="badge" class:buy={sp.side === "buy"} class:sell={sp.side === "sell"}>{sp.side.toUpperCase()}</span></td>
								<td class="price">{formatPrice(sp.entryPrice, sp.instrument)}</td>
								<td class="price">{formatPrice(sp.stopLoss, sp.instrument)}</td>
								<td class:pos={sp.pnl > 0} class:neg={sp.pnl < 0}>{sp.pnl.toFixed(5)}</td>
								<td>{sp.peakPnl.toFixed(5)}</td>
								<td>{sp.trailingActive ? "Active" : "—"}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		{:else}
			<div class="runner-status">
				<span class="runner-dot"></span>
				Runner not active — start with <code>npm run live</code>
			</div>
		{/if}
	</section>

	{#if tradeLog.length > 0}
		<section>
			<h2>Today's Activity</h2>
			<div class="trade-log">
				{#each tradeLog.toReversed() as entry}
					<div class="log-entry" class:trade={entry.type === "trade"} class:exit={entry.type === "exit"} class:status={entry.type === "status"}>
						<span class="log-time">{entry.timestamp.slice(11, 19)}</span>
						<span class="log-type">{entry.type.toUpperCase()}</span>
						<span class="log-message">{entry.message}</span>
					</div>
				{/each}
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
	.status {
		font-size: 0.85em;
		color: #8b949e;
	}
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #f85149;
		margin-right: 4px;
	}
	.dot.connected {
		background: #3fb950;
	}
	.session-bar {
		background: #161b22;
		border: 1px solid #21262d;
		border-left: 3px solid;
		border-radius: 6px;
		padding: 10px 16px;
		margin-bottom: 20px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.session-label {
		font-weight: 600;
		font-size: 0.95em;
	}
	.london-clock {
		font-size: 0.85em;
		color: #8b949e;
		font-variant-numeric: tabular-nums;
	}
	h2 {
		font-size: 1.1em;
		color: #8b949e;
		border-bottom: 1px solid #21262d;
		padding-bottom: 6px;
		margin: 20px 0 12px;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
	}
	.card {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 6px;
		padding: 10px 14px;
	}
	.card .label {
		font-size: 0.7em;
		color: #8b949e;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.card .value {
		font-size: 1.2em;
		font-weight: 600;
		margin-top: 2px;
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
	.spread {
		color: #8b949e;
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
	h3 {
		font-size: 0.95em;
		color: #8b949e;
		margin: 16px 0 8px;
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
	code {
		background: #161b22;
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 0.85em;
	}
	.compact {
		font-size: 0.85em;
	}
	.compact th, .compact td {
		padding: 5px 8px;
	}
	.trade-log {
		max-height: 400px;
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
