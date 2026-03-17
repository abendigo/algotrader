<script lang="ts">
	let { data } = $props();
</script>

<h1>Backtests</h1>

{#if data.reports.length === 0}
	<p class="muted">No reports found.</p>
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
			{#each data.reports as report}
				<tr>
					<td>{report.strategy}</td>
					<td>{report.granularity}</td>
					<td>{report.timestamp}</td>
					<td>
						<a href="/backtests/{report.filename}">View</a>
						{#if report.hasCsv}
							<a href="/backtests/{report.filename}/csv" class="secondary">CSV</a>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	h1 {
		font-size: 1.4em;
		margin-bottom: 16px;
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
	.muted {
		color: #8b949e;
	}
	.secondary {
		color: #8b949e;
		margin-left: 8px;
	}
</style>
