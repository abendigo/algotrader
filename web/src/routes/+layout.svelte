<script lang="ts">
	import { navigating } from "$app/stores";
	import { onMount } from "svelte";

	let { children, data } = $props();
	const version = __GIT_SHA__;

	let theme = $state<"system" | "light" | "dark">("system");

	onMount(() => {
		theme = (localStorage.getItem("theme") as typeof theme) ?? "system";
	});

	function cycleTheme() {
		const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
		theme = next;
		const el = document.documentElement;
		el.classList.remove("light", "dark");
		if (next === "light") el.classList.add("light");
		else if (next === "dark") el.classList.add("dark");
		if (next === "system") localStorage.removeItem("theme");
		else localStorage.setItem("theme", next);
	}

	const themeIcon = $derived(theme === "light" ? "☀" : theme === "dark" ? "☾" : "◐");
</script>

<svelte:head>
	<title>Algotrader</title>
</svelte:head>

{#if $navigating}
	<div class="nav-progress"></div>
{/if}

<div class="app">
	<nav>
		<div class="nav-inner">
			<a href="/" class="logo">Algotrader</a><span class="version">{version}</span>
			<div class="links">
				{#if data.user}
					<a href="/strategies">Strategies</a>
					<a href="/live">Live</a>
					<a href="/backtests">Backtests</a>
					<a href="/docs/strategies">Docs</a>
					{#if data.user.role === "admin"}
						<a href="/admin">Admin</a>
					{/if}
					<a href="/profile" class="user-link">{data.user.email}</a>
					<a href="/logout" class="logout" data-sveltekit-reload>Log out</a>
				{:else}
					<a href="/docs/strategies">Docs</a>
					<a href="/login">Log In</a>
					<a href="/register">Register</a>
				{/if}
				<button class="theme-toggle" onclick={cycleTheme} title="Theme: {theme}">{themeIcon}</button>
			</div>
		</div>
	</nav>
	<main>
		{@render children()}
	</main>
</div>

<style>
	/* ===== Theme Variables ===== */

	/* Light theme (default) */
	:global(:root) {
		--bg-primary: #ffffff;
		--bg-secondary: #f6f8fa;
		--bg-tertiary: #e6edf3;
		--bg-hover: #f0f3f6;
		--bg-nav: #f6f8fa;
		--border: #d1d9e0;
		--border-light: #d1d9e0;
		--text-primary: #1f2328;
		--text-secondary: #656d76;
		--text-muted: #8b949e;
		--accent: #0969da;
		--accent-hover: #0550ae;
		--success: #1a7f37;
		--success-bg: #dafbe1;
		--danger: #cf222e;
		--danger-bg: #ffebe9;
		--danger-hover: #a40e26;
		--warning: #9a6700;
		--warning-bg: #fff8c5;
		--purple: #8250df;
		--purple-bg: #ede1fc;
		--badge-buy-bg: #ddf4ff;
		--badge-buy-text: #0969da;
		--badge-sell-bg: #ffebe9;
		--badge-sell-text: #cf222e;
		--badge-warn-bg: #fff8c5;
		--badge-warn-text: #9a6700;
		--btn-primary-bg: #1f883d;
		--btn-primary-hover: #1a7f37;
		--btn-secondary-bg: #f6f8fa;
		--btn-secondary-border: #d1d9e0;
		--btn-secondary-hover: #e6edf3;
		--selection-bg: #b6d7ff;
		--card-bg: #ffffff;
		--card-border: #d1d9e0;
		--input-bg: #ffffff;
		--input-border: #d1d9e0;
		--modal-backdrop: rgba(0, 0, 0, 0.3);
		--modal-bg: #ffffff;
		--collecting: #9a6700;
	}

	/* Dark theme via system preference */
	@media (prefers-color-scheme: dark) {
		:global(:root:not(.light)) {
			--bg-primary: #0d1117;
			--bg-secondary: #161b22;
			--bg-tertiary: #21262d;
			--bg-hover: #1c2128;
			--bg-nav: #161b22;
			--border: #21262d;
			--border-light: #30363d;
			--text-primary: #c9d1d9;
			--text-secondary: #8b949e;
			--text-muted: #484f58;
			--accent: #58a6ff;
			--accent-hover: #79c0ff;
			--success: #3fb950;
			--success-bg: #0d2818;
			--danger: #f85149;
			--danger-bg: #5d1a1a;
			--danger-hover: #ff7b72;
			--warning: #d29922;
			--warning-bg: #2a2000;
			--purple: #a371f7;
			--purple-bg: #2a1a4a;
			--badge-buy-bg: #0d419d;
			--badge-buy-text: #58a6ff;
			--badge-sell-bg: #5d1a1a;
			--badge-sell-text: #f85149;
			--badge-warn-bg: #5d3a00;
			--badge-warn-text: #d29922;
			--btn-primary-bg: #238636;
			--btn-primary-hover: #2ea043;
			--btn-secondary-bg: #21262d;
			--btn-secondary-border: #30363d;
			--btn-secondary-hover: #30363d;
			--selection-bg: #264f78;
			--card-bg: #161b22;
			--card-border: #21262d;
			--input-bg: #0d1117;
			--input-border: #30363d;
			--modal-backdrop: rgba(0, 0, 0, 0.6);
			--modal-bg: #161b22;
			--collecting: #d29922;
		}
	}

	/* Dark theme via explicit user choice */
	:global(:root.dark) {
		--bg-primary: #0d1117;
		--bg-secondary: #161b22;
		--bg-tertiary: #21262d;
		--bg-hover: #1c2128;
		--bg-nav: #161b22;
		--border: #21262d;
		--border-light: #30363d;
		--text-primary: #c9d1d9;
		--text-secondary: #8b949e;
		--text-muted: #484f58;
		--accent: #58a6ff;
		--accent-hover: #79c0ff;
		--success: #3fb950;
		--success-bg: #0d2818;
		--danger: #f85149;
		--danger-bg: #5d1a1a;
		--danger-hover: #ff7b72;
		--warning: #d29922;
		--warning-bg: #2a2000;
		--purple: #a371f7;
		--purple-bg: #2a1a4a;
		--badge-buy-bg: #0d419d;
		--badge-buy-text: #58a6ff;
		--badge-sell-bg: #5d1a1a;
		--badge-sell-text: #f85149;
		--badge-warn-bg: #5d3a00;
		--badge-warn-text: #d29922;
		--btn-primary-bg: #238636;
		--btn-primary-hover: #2ea043;
		--btn-secondary-bg: #21262d;
		--btn-secondary-border: #30363d;
		--btn-secondary-hover: #30363d;
		--selection-bg: #264f78;
		--card-bg: #161b22;
		--card-border: #21262d;
		--input-bg: #0d1117;
		--input-border: #30363d;
		--modal-backdrop: rgba(0, 0, 0, 0.6);
		--modal-bg: #161b22;
		--collecting: #d29922;
	}

	/* Light theme via explicit user choice */
	:global(:root.light) {
		--bg-primary: #ffffff;
		--bg-secondary: #f6f8fa;
		--bg-tertiary: #e6edf3;
		--bg-hover: #f0f3f6;
		--bg-nav: #f6f8fa;
		--border: #d1d9e0;
		--border-light: #d1d9e0;
		--text-primary: #1f2328;
		--text-secondary: #656d76;
		--text-muted: #8b949e;
		--accent: #0969da;
		--accent-hover: #0550ae;
		--success: #1a7f37;
		--success-bg: #dafbe1;
		--danger: #cf222e;
		--danger-bg: #ffebe9;
		--danger-hover: #a40e26;
		--warning: #9a6700;
		--warning-bg: #fff8c5;
		--purple: #8250df;
		--purple-bg: #ede1fc;
		--badge-buy-bg: #ddf4ff;
		--badge-buy-text: #0969da;
		--badge-sell-bg: #ffebe9;
		--badge-sell-text: #cf222e;
		--badge-warn-bg: #fff8c5;
		--badge-warn-text: #9a6700;
		--btn-primary-bg: #1f883d;
		--btn-primary-hover: #1a7f37;
		--btn-secondary-bg: #f6f8fa;
		--btn-secondary-border: #d1d9e0;
		--btn-secondary-hover: #e6edf3;
		--selection-bg: #b6d7ff;
		--card-bg: #ffffff;
		--card-border: #d1d9e0;
		--input-bg: #ffffff;
		--input-border: #d1d9e0;
		--modal-backdrop: rgba(0, 0, 0, 0.3);
		--modal-bg: #ffffff;
		--collecting: #9a6700;
	}

	/* ===== Layout Styles ===== */

	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		height: 4px;
		background: var(--accent);
		z-index: 1000;
		animation: progress 1.5s ease-in-out infinite;
	}
	@keyframes progress {
		0% { width: 0%; }
		50% { width: 70%; }
		100% { width: 95%; }
	}
	:global(body) {
		margin: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
		background: var(--bg-primary);
		color: var(--text-primary);
	}
	:global(a) {
		color: var(--accent);
		text-decoration: none;
	}
	:global(a:hover) {
		text-decoration: underline;
	}
	:global(button) {
		transition: opacity 0.1s, transform 0.1s;
	}
	:global(button:active:not(:disabled)) {
		transform: scale(0.97);
		opacity: 0.8;
	}
	:global(button:disabled) {
		cursor: not-allowed;
	}
	.app {
		min-height: 100vh;
	}
	nav {
		background: var(--bg-nav);
		border-bottom: 1px solid var(--border);
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
		color: var(--text-primary);
	}
	.version {
		font-size: 0.7em;
		color: var(--text-muted);
		margin-left: 8px;
		font-family: monospace;
	}
	.links {
		display: flex;
		gap: 16px;
		font-size: 0.9em;
		align-items: center;
		margin-left: auto;
	}
	.user-link {
		color: var(--text-secondary);
		font-size: 0.85em;
	}
	.logout {
		color: var(--text-secondary);
	}
	.theme-toggle {
		background: none;
		border: 1px solid var(--border-light);
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1em;
		padding: 2px 8px;
		border-radius: 4px;
		line-height: 1;
	}
	.theme-toggle:hover {
		color: var(--text-primary);
		border-color: var(--accent);
	}
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 24px;
	}

	/* Utility classes */
	:global(.pos) { color: var(--success); }
	:global(.neg) { color: var(--danger); }
	:global(.muted) { color: var(--text-secondary); }
	:global(.mono) { font-family: monospace; }

	/* Base form styles */
	:global(select),
	:global(input[type="text"]),
	:global(input[type="number"]),
	:global(input[type="date"]),
	:global(input[type="password"]),
	:global(input[type="email"]) {
		padding: 6px 10px;
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.85em;
	}
	:global(select:focus),
	:global(input:focus) {
		outline: none;
		border-color: var(--accent);
	}

	/* Success/error message blocks */
	:global(.msg-success) {
		background: var(--success-bg);
		color: var(--success);
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 0.85em;
		margin-bottom: 12px;
	}
	:global(.msg-error) {
		background: var(--danger-bg);
		color: var(--danger);
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 0.85em;
		margin-bottom: 12px;
	}
</style>
