<script lang="ts">
	let { data } = $props();
</script>

<div class="strategies-page">
	<div class="page-header">
		<h1>My Strategies</h1>
		<div class="tabs">
			<a href="/strategies/shared" class="tab">Shared</a>
			<a href="/strategies/mine" class="tab active">My Strategies</a>
		</div>
	</div>

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
</style>
