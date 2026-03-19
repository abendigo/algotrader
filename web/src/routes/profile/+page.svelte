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
		<div class="msg-success">{form.message}</div>
	{/if}
	{#if form?.error}
		<div class="msg-error">{form.error}</div>
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
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border);
		padding-bottom: 6px;
		margin: 28px 0 12px;
	}
	h3 {
		font-size: 1em;
		margin-bottom: 12px;
	}
	.hint {
		color: var(--text-secondary);
		font-size: 0.85em;
		margin-bottom: 12px;
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		font-size: 0.9em;
	}
	.info-row .label { color: var(--text-secondary); }
	:global(.msg-success), :global(.msg-error) { margin-bottom: 16px; }
	.key-status {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}
	.key-set {
		color: var(--success);
		font-size: 0.9em;
	}
	.input-row {
		display: flex;
		gap: 8px;
	}
	input {
		padding: 8px 12px;
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.9em;
		box-sizing: border-box;
	}
	.input-row input { flex: 1; }
	.badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 0.8em;
		font-weight: 600;
	}
	.badge.admin { background: var(--badge-buy-bg); color: var(--accent); }
	.btn-primary {
		padding: 8px 16px;
		background: var(--btn-primary-bg);
		color: #fff;
		border: none;
		border-radius: 4px;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.9em;
	}
	.btn-primary:hover { background: var(--btn-primary-hover); }
	.btn-danger {
		padding: 4px 10px;
		background: transparent;
		color: var(--danger);
		border: 1px solid var(--danger);
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
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.9em;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.broker-tab:hover { background: var(--bg-secondary); }
	.broker-tab.active {
		background: var(--bg-secondary);
		color: var(--text-primary);
		border-color: var(--accent);
	}
	.coming-soon-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--warning);
	}
	.coming-soon-panel {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 32px;
		text-align: center;
	}
	.coming-soon-panel h3 { font-size: 1.2em; margin-bottom: 4px; }
	.coming-soon-panel .description { color: var(--text-secondary); font-size: 0.9em; margin-bottom: 16px; }
	.coming-soon-text {
		color: var(--warning);
		font-weight: 600;
		font-size: 1.1em;
		margin-bottom: 8px;
	}
</style>
