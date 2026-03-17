<script lang="ts">
	let { data } = $props();
</script>

<div class="dashboard">
	<h1>Dashboard</h1>

	<section class="data-section">
		<h2>Historical Data</h2>
		{#each data.data.brokers as broker}
			<h3 class="broker-name">{broker.name}</h3>
			<div class="cards">
				{#each broker.granularities as gran}
					<div class="card">
						<div class="card-header">{gran.name}</div>
						<div class="card-body">
							<div class="stat">
								<span class="label">Instruments</span>
								<span class="value">{gran.instruments}</span>
							</div>
							<div class="stat">
								<span class="label">Days</span>
								<span class="value">{gran.days}</span>
							</div>
							<div class="stat">
								<span class="label">Range</span>
								<span class="value">{gran.dateRange.from} to {gran.dateRange.to}</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/each}
	</section>

	<section class="reports-section">
		<h2>Recent Backtests</h2>
		{#if data.reports.length === 0}
			<p class="muted">No backtest reports found. Run a backtest first.</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Strategy</th>
						<th>Granularity</th>
						<th>Timestamp</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.reports.slice(0, 20) as report}
						<tr>
							<td>{report.strategy}</td>
							<td>{report.granularity}</td>
							<td>{report.timestamp}</td>
							<td>
								<a href="/backtests/{report.filename}">View</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</div>

<style>
	.dashboard h1 {
		font-size: 1.4em;
		margin-bottom: 24px;
	}
	h2 {
		font-size: 1.1em;
		color: #8b949e;
		border-bottom: 1px solid #21262d;
		padding-bottom: 6px;
		margin: 24px 0 12px;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 12px;
	}
	.card {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 6px;
		overflow: hidden;
	}
	.card-header {
		background: #1c2128;
		padding: 8px 16px;
		font-weight: 600;
		font-size: 1.1em;
	}
	.card-body {
		padding: 12px 16px;
	}
	.stat {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
	}
	.label {
		color: #8b949e;
		font-size: 0.85em;
	}
	.value {
		font-weight: 500;
	}
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
	tr:hover td {
		background: #1c2128;
	}
	.broker-name {
		font-size: 0.95em;
		color: #58a6ff;
		margin: 12px 0 8px;
		text-transform: capitalize;
	}
	.muted {
		color: #8b949e;
	}
</style>
