<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";

	let { data, form } = $props();
	let copyingId = $state<string | null>(null);

	function fmtPct(n: number): string {
		return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
	}
</script>

<div class="catalog">
	<h1>Strategies</h1>

	{#if form?.success}
		<div class="success">{form.message}</div>
	{/if}
	{#if form?.error}
		<div class="error">{form.error}</div>
	{/if}

	{#if data.userStrategies.length > 0}
		<section>
			<h2>My Strategies</h2>
			<div class="strategy-grid">
				{#each data.userStrategies as strategy}
					<a href="/strategies/{strategy.id}/editor" class="strategy-card">
						<div class="card-top">
							<span class="card-name">{strategy.name}</span>
							{#if strategy.bestReturn != null}
								<span class="card-stat" class:pos={strategy.bestReturn > 0} class:neg={strategy.bestReturn < 0}>
									{fmtPct(strategy.bestReturn)} <span class="stat-label">realistic</span>
								</span>
							{/if}
						</div>
						{#if strategy.description}
							<p class="card-desc">{strategy.description}</p>
						{/if}
						<div class="card-meta">
							<span class="mono">{strategy.id}.ts</span>
							{#if strategy.fileSize != null}
								<span>{strategy.fileSize < 1024 ? `${strategy.fileSize} B` : `${(strategy.fileSize / 1024).toFixed(1)} KB`}</span>
							{/if}
							{#if strategy.modifiedAt}
								<span>{new Date(strategy.modifiedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
							{/if}
							{#if strategy.backtestCount > 0}
								<span>{strategy.backtestCount} backtest{strategy.backtestCount !== 1 ? "s" : ""}</span>
							{/if}
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if data.available.length > 0}
		<section>
			<h2>Available</h2>
			<p class="intro">Built-in and community strategies. Copy to customize and backtest.</p>
			<div class="strategy-grid">
				{#each data.available as strategy}
					<div class="strategy-card available-card">
						<div class="card-top">
							<span class="card-name">{strategy.name}</span>
							<span class="card-source">{strategy.source}</span>
						</div>
						{#if strategy.description}
							<p class="card-desc">{strategy.description}</p>
						{/if}
						<div class="card-actions">
							{#if strategy.alreadyCopied}
								<span class="already-copied">In your collection</span>
							{:else}
								<form method="POST" action="?/copy" use:enhance={() => { copyingId = strategy.id; return async ({ update }) => { await update(); copyingId = null; await invalidateAll(); }; }}>
									<input type="hidden" name="strategyId" value={strategy.id} />
									<button type="submit" class="btn-copy" disabled={copyingId === strategy.id}>{copyingId === strategy.id ? "Copying..." : "Copy"}</button>
								</form>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if data.userStrategies.length === 0 && data.available.length === 0}
		<p class="intro">No strategies available yet.</p>
	{/if}
</div>

<style>
	h1 { font-size: 1.4em; margin-bottom: 16px; }
	h2 { font-size: 1.1em; color: #8b949e; border-bottom: 1px solid #21262d; padding-bottom: 6px; margin: 24px 0 12px; }
	h2:first-of-type { margin-top: 0; }
	.intro { color: #8b949e; font-size: 0.9em; margin-bottom: 12px; }
	.success { background: #0d2818; color: #3fb950; padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 16px; }
	.error { background: #5d1a1a; color: #f85149; padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 16px; }

	.strategy-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 12px;
	}
	.strategy-card {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 16px;
		text-decoration: none;
		color: #c9d1d9;
		transition: border-color 0.15s;
	}
	.strategy-card:hover {
		border-color: #58a6ff;
		text-decoration: none;
	}
	.available-card {
		cursor: default;
	}
	.available-card:hover {
		border-color: #21262d;
	}
	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.card-name { font-weight: 600; font-size: 1em; }
	.card-stat { font-size: 0.9em; font-weight: 600; }
	.stat-label { font-weight: 400; color: #484f58; font-size: 0.8em; }
	.card-source { font-size: 0.75em; color: #8b949e; text-transform: uppercase; }
	.pos { color: #3fb950; }
	.neg { color: #f85149; }
	.card-desc {
		color: #8b949e;
		font-size: 0.85em;
		line-height: 1.4;
		margin: 0 0 8px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.card-meta {
		display: flex;
		gap: 12px;
		font-size: 0.8em;
		color: #484f58;
	}
	.mono { font-family: monospace; }
	.card-actions {
		margin-top: 8px;
	}
	.already-copied { color: #3fb950; font-size: 0.85em; }
	.btn-copy {
		padding: 4px 12px;
		background: #238636;
		color: #fff;
		border: none;
		border-radius: 4px;
		font-weight: 600;
		font-size: 0.82em;
		cursor: pointer;
	}
	.btn-copy:hover { background: #2ea043; }
</style>
