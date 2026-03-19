<script lang="ts">
	let { data } = $props();
</script>

<div class="report-nav">
	<a href="/backtests">&larr; All backtests</a>
	<span class="filename">{data.filename}</span>
</div>

<div class="report-frame">
	<iframe srcdoc={data.html} title="Backtest Report"></iframe>
</div>

<style>
	.report-nav {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 12px;
		font-size: 0.9em;
	}
	.filename {
		color: var(--text-secondary);
	}
	.report-frame {
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}
	iframe {
		width: 100%;
		height: calc(100vh - 140px);
		border: none;
		background: var(--bg-primary);
	}
</style>
