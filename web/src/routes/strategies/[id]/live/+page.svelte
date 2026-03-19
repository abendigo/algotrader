<script lang="ts">
	let { data } = $props();
</script>

<div class="live-tab">
	<div class="placeholder">
		<h2>Live Trading</h2>
		<p>Real-money trading is coming soon.</p>
		<p>Use <a href="/strategies/{data.strategy.id}/paper">Paper Trading</a> to test your strategy with the OANDA practice API first.</p>
	</div>
</div>

<style>
	.placeholder {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 40px;
		text-align: center;
		color: #8b949e;
	}
	h2 { font-size: 1.1em; color: #c9d1d9; margin: 0 0 12px; }
	p { margin: 4px 0; }
</style>
