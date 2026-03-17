<script lang="ts">
	let { children, data } = $props();
</script>

<svelte:head>
	<title>Algotrader</title>
</svelte:head>

<div class="app">
	<nav>
		<div class="nav-inner">
			<a href="/" class="logo">Algotrader</a>
			<div class="links">
				{#if data.user}
					<a href="/dashboard">Dashboard</a>
					<a href="/live">Live</a>
					<a href="/strategies">Strategies</a>
					<a href="/backtests">Backtests</a>
					{#if data.user.role === "admin"}
						<a href="/admin">Admin</a>
					{/if}
					<a href="/profile" class="user-link">{data.user.email}</a>
					<a href="/logout" class="logout">Log out</a>
				{:else}
					<a href="/login">Log In</a>
					<a href="/register">Register</a>
				{/if}
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
		align-items: center;
		margin-left: auto;
	}
	.user-link {
		color: #8b949e;
		font-size: 0.85em;
	}
	.logout {
		color: #8b949e;
	}
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 24px;
	}
</style>
