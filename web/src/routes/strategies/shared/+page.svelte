<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";

	let { data, form } = $props();
</script>

{#snippet strategyCard(strategy: any)}
	<div class="strategy-card">
		<div class="card-header">
			<h3>{strategy.name}</h3>
		</div>

		{#if strategy.description}
			<p class="description">{strategy.description}</p>
		{/if}

		<div class="card-actions">
			{#if strategy.alreadyCopied}
				<span class="already-copied">Already in your collection</span>
			{:else}
				<form method="POST" action="?/copy" use:enhance={() => { return async ({ update }) => { await update(); await invalidateAll(); }; }}>
					<input type="hidden" name="strategyId" value={strategy.id} />
					<button type="submit" class="btn-copy">Copy to My Strategies</button>
				</form>
			{/if}
		</div>
	</div>
{/snippet}

<div class="strategies-page">
	<div class="page-header">
		<h1>Shared Strategies</h1>
		<div class="tabs">
			<a href="/strategies/shared" class="tab active">Shared</a>
			<a href="/strategies/mine" class="tab">My Strategies</a>
		</div>
	</div>

	{#if form?.success}
		<div class="success">{form.message}</div>
	{/if}
	{#if form?.error}
		<div class="error">{form.error}</div>
	{/if}

	{#if data.builtin.length > 0}
		<h2 class="section-title">Built-in</h2>
		<p class="intro">Strategies included with the platform. Copy to customize.</p>
		<div class="strategy-grid">
			{#each data.builtin as strategy}
				{@render strategyCard(strategy)}
			{/each}
		</div>
	{/if}

	{#if data.shared.length > 0}
		<h2 class="section-title">Community</h2>
		<p class="intro">Strategies shared by other users. Copy them to your collection, customize, and backtest.</p>
		<div class="strategy-grid">
			{#each data.shared as strategy}
				{@render strategyCard(strategy)}
			{/each}
		</div>
	{/if}

	{#if data.builtin.length === 0 && data.shared.length === 0}
		<p class="intro">No shared strategies available yet.</p>
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
		margin-bottom: 16px;
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
	.intro {
		color: #8b949e;
		font-size: 0.9em;
		margin-bottom: 16px;
	}
	.section-title {
		font-size: 1.1em;
		color: #8b949e;
		border-bottom: 1px solid #21262d;
		padding-bottom: 6px;
		margin: 24px 0 8px;
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
	.strategy-grid {
		display: grid;
		gap: 16px;
	}
	.strategy-card {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 20px;
	}
	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 12px;
	}
	.card-header h3 {
		font-size: 1.1em;
		margin: 0;
	}
	.badges {
		display: flex;
		gap: 6px;
	}
	.badge {
		padding: 2px 8px;
		border-radius: 3px;
		font-size: 0.75em;
		font-weight: 600;
	}
	.badge.category { background: #0d419d; color: #58a6ff; }
	.badge.experimental { background: #3d2e00; color: #d29922; }
	.description {
		color: #c9d1d9;
		font-size: 0.9em;
		line-height: 1.5;
		margin-bottom: 12px;
	}
	.meta {
		margin-bottom: 12px;
	}
	.meta-row {
		display: flex;
		gap: 12px;
		font-size: 0.85em;
		padding: 3px 0;
	}
	.meta-row .label {
		color: #8b949e;
		min-width: 90px;
	}
	.backtest-note {
		background: #0d1117;
		border: 1px solid #21262d;
		border-radius: 4px;
		padding: 10px 12px;
		margin-bottom: 12px;
	}
	.note-label {
		font-size: 0.75em;
		color: #8b949e;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.backtest-note p {
		font-size: 0.85em;
		color: #c9d1d9;
		margin-top: 4px;
		line-height: 1.5;
	}
	.card-actions {
		display: flex;
		align-items: center;
	}
	.btn-copy {
		padding: 8px 16px;
		background: #238636;
		color: #fff;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.9em;
		cursor: pointer;
	}
	.btn-copy:hover { background: #2ea043; }
	.already-copied {
		color: #3fb950;
		font-size: 0.85em;
	}
</style>
