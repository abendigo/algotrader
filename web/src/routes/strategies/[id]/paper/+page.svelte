<script lang="ts">
	let { data } = $props();
</script>

<div class="paper-tab">
	<div class="placeholder">
		<h2>Paper Trading</h2>
		<p>Paper trading is coming soon.</p>
		<p>For now, use <a href="/strategies/{data.strategy.id}/live">Live Trading</a> with a practice account to simulate trades.</p>
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
