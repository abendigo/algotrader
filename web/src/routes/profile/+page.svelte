<script lang="ts">
	import { enhance } from "$app/forms";

	let { data, form } = $props();

	let selectedBroker = $state("oanda");

	const brokers = [
		{ id: "oanda", name: "OANDA", status: "active", description: "Forex — REST v20 API + streaming" },
		{ id: "tradovate", name: "Tradovate", status: "coming-soon", description: "Futures — modern REST + WebSocket API" },
		{ id: "binance", name: "Binance", status: "coming-soon", description: "Crypto — testnet for paper trading" },
		{ id: "hyperliquid", name: "Hyperliquid", status: "coming-soon", description: "On-chain perps — stretch goal" },
	];
</script>

<div class="profile-page">
	<h1>Profile</h1>

	{#if form?.success}
		<div class="success">{form.message}</div>
	{/if}
	{#if form?.error}
		<div class="error">{form.error}</div>
	{/if}

	<section>
		<h2>Account</h2>
		<div class="info-row">
			<span class="label">Email</span>
			<span class="value">{data.user?.email}</span>
		</div>
		<div class="info-row">
			<span class="label">Role</span>
			<span class="value badge" class:admin={data.user?.role === "admin"}>{data.user?.role}</span>
		</div>
	</section>

	<section>
		<h2>Brokers</h2>
		<div class="broker-tabs">
			{#each brokers as broker}
				<button
					class="broker-tab"
					class:active={selectedBroker === broker.id}
					onclick={() => selectedBroker = broker.id}
				>
					{broker.name}
					{#if broker.status === "coming-soon"}
						<span class="coming-soon-dot"></span>
					{/if}
				</button>
			{/each}
		</div>

		{#if selectedBroker !== "oanda"}
			{@const broker = brokers.find(b => b.id === selectedBroker)}
			<div class="coming-soon-panel">
				<h3>{broker?.name}</h3>
				<p class="description">{broker?.description}</p>
				<p class="coming-soon-text">Not yet implemented</p>
				<p class="hint">Support for {broker?.name} is on the roadmap. Check back soon.</p>
			</div>
		{/if}
	</section>

	{#if selectedBroker === "oanda"}
	<section>
		<h2>OANDA API Key</h2>
		<p class="hint">Your API key is used to access your OANDA accounts. Generate one at Account &rarr; Manage API Access on the OANDA platform. If you add new sub-accounts, regenerate the key so it can access them.</p>

		{#if data.user?.hasApiKey}
			<div class="key-status">
				<span class="key-set">API key is set</span>
				<form method="POST" action="?/clearApiKey" use:enhance>
					<button type="submit" class="btn-danger">Remove</button>
				</form>
			</div>
		{/if}

		<form method="POST" action="?/saveApiKey" use:enhance>
			<div class="input-row">
				<input type="text" name="apiKey" autocomplete="off" data-1p-ignore placeholder={data.user?.hasApiKey ? "Replace API key..." : "Paste your OANDA API key"} />
				<button type="submit" class="btn-primary">Save</button>
			</div>
		</form>
	</section>
	{/if}
</div>

<style>
	.profile-page h1 {
		font-size: 1.4em;
		margin-bottom: 24px;
	}
	h2 {
		font-size: 1.1em;
		color: #8b949e;
		border-bottom: 1px solid #21262d;
		padding-bottom: 6px;
		margin: 28px 0 12px;
	}
	h3 {
		font-size: 1em;
		margin-bottom: 12px;
	}
	.hint {
		color: #8b949e;
		font-size: 0.85em;
		margin-bottom: 12px;
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		font-size: 0.9em;
	}
	.info-row .label { color: #8b949e; }
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
	.key-status {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}
	.key-set {
		color: #3fb950;
		font-size: 0.9em;
	}
	.input-row {
		display: flex;
		gap: 8px;
	}
	input {
		padding: 8px 12px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.9em;
		box-sizing: border-box;
	}
	.input-row input { flex: 1; }
	input:focus {
		outline: none;
		border-color: #58a6ff;
	}
	.badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 0.8em;
		font-weight: 600;
	}
	.badge.admin { background: #0d419d; color: #58a6ff; }
	.btn-primary {
		padding: 8px 16px;
		background: #238636;
		color: #fff;
		border: none;
		border-radius: 4px;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.9em;
	}
	.btn-primary:hover { background: #2ea043; }
	.btn-danger {
		padding: 4px 10px;
		background: transparent;
		color: #f85149;
		border: 1px solid #f85149;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8em;
	}
	.broker-tabs {
		display: flex;
		gap: 4px;
		margin-bottom: 16px;
	}
	.broker-tab {
		padding: 8px 16px;
		background: #0d1117;
		border: 1px solid #21262d;
		border-radius: 6px;
		color: #8b949e;
		cursor: pointer;
		font-size: 0.9em;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.broker-tab:hover { background: #161b22; }
	.broker-tab.active {
		background: #161b22;
		color: #c9d1d9;
		border-color: #58a6ff;
	}
	.coming-soon-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #d29922;
	}
	.coming-soon-panel {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 6px;
		padding: 32px;
		text-align: center;
	}
	.coming-soon-panel h3 { font-size: 1.2em; margin-bottom: 4px; }
	.coming-soon-panel .description { color: #8b949e; font-size: 0.9em; margin-bottom: 16px; }
	.coming-soon-text {
		color: #d29922;
		font-weight: 600;
		font-size: 1.1em;
		margin-bottom: 8px;
	}
</style>
