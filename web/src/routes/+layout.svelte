<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>Algotrader</title>
</svelte:head>

<div class="app">
	<nav>
		<div class="nav-inner">
			<a href="/" class="logo">Algotrader</a>
			<div class="links">
				<a href="/">Dashboard</a>
				<a href="/live">Live</a>
				<a href="/backtests">Backtests</a>
			</div>
		</div>
	</nav>
	<main>
		{@render children()}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
		background: #0d1117;
		color: #c9d1d9;
	}
	:global(a) {
		color: #58a6ff;
		text-decoration: none;
	}
	:global(a:hover) {
		text-decoration: underline;
	}
	.app {
		min-height: 100vh;
	}
	nav {
		background: #161b22;
		border-bottom: 1px solid #21262d;
		padding: 0 24px;
	}
	.nav-inner {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		height: 48px;
		gap: 32px;
	}
	.logo {
		font-weight: 700;
		font-size: 1.1em;
		color: #c9d1d9;
	}
	.links {
		display: flex;
		gap: 16px;
		font-size: 0.9em;
	}
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 24px;
	}
</style>
