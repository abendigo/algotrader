<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";

	let { data, form } = $props();

	const strategies = [
		{ value: "", label: "None (manual)" },
		{ value: "london-breakout", label: "London Breakout" },
		{ value: "lead-lag", label: "Lead-Lag" },
		{ value: "session-divergence", label: "Session Divergence" },
		{ value: "correlation-pairs", label: "Correlation Pairs" },
		{ value: "range-fade", label: "Range Fade" },
		{ value: "cross-momentum", label: "Cross-Pair Momentum" },
		{ value: "currency-momentum", label: "Currency Momentum" },
		{ value: "cross-drift", label: "Cross-Rate Drift" },
	];

	let showAddAccount = $state(false);
	let testAccountId = $state("");
	let testResult = $state("");

	// Filter out accounts already linked
	const linkedIds = $derived(new Set(data.user?.accounts?.map((a: any) => a.accountId) ?? []));
	const availableOandaAccounts = $derived(
		data.oandaAccounts?.filter((a: any) => !linkedIds.has(a.id)) ?? []
	);
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
		<h2>OANDA API Key</h2>
		<p class="hint">Your API key is used to access all your OANDA accounts. Generate one at Account &rarr; Manage API Access on the OANDA platform.</p>

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
				<input type="password" name="apiKey" placeholder={data.user?.hasApiKey ? "Replace API key..." : "Paste your OANDA API key"} />
				<button type="submit" class="btn-primary">Save</button>
			</div>
		</form>
	</section>

	<section>
		<h2>Trading Accounts</h2>
		<p class="hint">Link your OANDA sub-accounts. Each account can run a different strategy independently.</p>

		{#if data.user?.accounts && data.user.accounts.length > 0}
			<table>
				<thead>
					<tr>
						<th>Label</th>
						<th>Account ID</th>
						<th>Strategy</th>
						<th>Type</th>
						<th>Units</th>
						<th>Status</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.user.accounts as account}
						<tr>
							<td class="account-label">{account.label}</td>
							<td class="mono">{account.accountId}</td>
							<td>{account.strategy || "—"}</td>
							<td><span class="badge" class:practice={account.type === "practice"} class:live-badge={account.type === "live"}>{account.type}</span></td>
							<td>{account.units}</td>
							<td>
								<form method="POST" action="?/toggleAccount" use:enhance={() => { return async ({ update }) => { await update(); await invalidateAll(); }; }}>
									<input type="hidden" name="id" value={account.id} />
									<input type="hidden" name="active" value={(!account.active).toString()} />
									<button type="submit" class="btn-toggle" class:active={account.active}>
										{account.active ? "Active" : "Paused"}
									</button>
								</form>
							</td>
							<td>
								<form method="POST" action="?/removeAccount" use:enhance={() => { return async ({ update }) => { await update(); await invalidateAll(); }; }}>
									<input type="hidden" name="id" value={account.id} />
									<button type="submit" class="btn-remove">Remove</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="muted">No accounts linked yet.</p>
		{/if}

		{#if availableOandaAccounts.length > 0}
			<div class="discovered">
				<h3>Discovered OANDA Accounts</h3>
				<p class="hint">These accounts are accessible with your API key but not yet linked.</p>
				{#each availableOandaAccounts as oandaAcct}
					<div class="discovered-account">
						<span class="mono">{oandaAcct.id}</span>
						{#if oandaAcct.tags?.length > 0}
							<span class="tags">{oandaAcct.tags.join(", ")}</span>
						{/if}
						<form method="POST" action="?/addAccount" use:enhance={() => { return async ({ update }) => { await update(); await invalidateAll(); }; }}>
							<input type="hidden" name="accountId" value={oandaAcct.id} />
							<input type="text" name="label" placeholder="Label" class="inline-input" required />
							<select name="strategy" class="inline-select">
								{#each strategies as s}
									<option value={s.value}>{s.label}</option>
								{/each}
							</select>
							<input type="hidden" name="type" value="practice" />
							<input type="hidden" name="units" value="100" />
							<button type="submit" class="btn-primary btn-sm">Link</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}

		{#if !showAddAccount}
			<button class="btn-secondary" onclick={() => showAddAccount = true}>Add Account Manually</button>
		{:else}
			<div class="add-account-form">
				<h3>Link OANDA Account</h3>

				{#if !data.user?.hasApiKey}
					<p class="error">Set your API key above first.</p>
				{:else}
					<form method="POST" action="?/addAccount" use:enhance={() => { return async ({ update }) => { showAddAccount = false; await update(); await invalidateAll(); }; }}>
						<label>
							<span>Account ID</span>
							<input type="text" name="accountId" placeholder="101-002-XXXXXXXX-XXX" required />
						</label>

						<label>
							<span>Label</span>
							<input type="text" name="label" placeholder="e.g., London Breakout Paper" required />
						</label>

						<label>
							<span>Strategy</span>
							<select name="strategy">
								{#each strategies as s}
									<option value={s.value}>{s.label}</option>
								{/each}
							</select>
						</label>

						<div class="row">
							<label class="half">
								<span>Type</span>
								<select name="type">
									<option value="practice">Practice</option>
									<option value="live">Live</option>
								</select>
							</label>
							<label class="half">
								<span>Units per trade</span>
								<input type="number" name="units" value="100" min="1" />
							</label>
						</div>

						<div class="form-actions">
							<button type="submit" class="btn-primary">Add Account</button>
							<button type="button" class="btn-secondary" onclick={() => showAddAccount = false}>Cancel</button>
						</div>
					</form>
				{/if}
			</div>
		{/if}
	</section>

	{#if data.user?.hasApiKey}
		<section>
			<h2>Test Connection</h2>
			<form method="POST" action="?/testConnection" use:enhance>
				<div class="input-row">
					<input type="text" name="accountId" placeholder="Account ID to test" bind:value={testAccountId} />
					<button type="submit" class="btn-secondary">Test</button>
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
	input, select {
		padding: 8px 12px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.9em;
		box-sizing: border-box;
	}
	.input-row input { flex: 1; }
	input:focus, select:focus {
		outline: none;
		border-color: #58a6ff;
	}
	label {
		display: block;
		margin-bottom: 12px;
	}
	label span {
		display: block;
		font-size: 0.85em;
		color: #8b949e;
		margin-bottom: 4px;
	}
	label input, label select {
		width: 100%;
	}
	.row {
		display: flex;
		gap: 12px;
	}
	.half { flex: 1; }
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85em;
		margin-bottom: 12px;
	}
	th {
		text-align: left;
		padding: 8px 10px;
		color: #8b949e;
		border-bottom: 2px solid #21262d;
	}
	td {
		padding: 8px 10px;
		border-bottom: 1px solid #21262d;
	}
	.account-label { font-weight: 600; }
	.mono { font-family: monospace; font-size: 0.85em; color: #8b949e; }
	.badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 0.8em;
		font-weight: 600;
	}
	.badge.admin { background: #0d419d; color: #58a6ff; }
	.badge.practice { background: #0d2818; color: #3fb950; }
	.badge.live-badge { background: #5d1a1a; color: #f85149; }
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
	.btn-secondary {
		padding: 8px 16px;
		background: #21262d;
		color: #c9d1d9;
		border: 1px solid #30363d;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.9em;
	}
	.btn-secondary:hover { background: #30363d; }
	.btn-danger {
		padding: 4px 10px;
		background: transparent;
		color: #f85149;
		border: 1px solid #f85149;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8em;
	}
	.btn-remove {
		padding: 2px 8px;
		background: transparent;
		color: #8b949e;
		border: 1px solid #30363d;
		border-radius: 3px;
		cursor: pointer;
		font-size: 0.8em;
	}
	.btn-toggle {
		padding: 2px 8px;
		background: #21262d;
		color: #8b949e;
		border: 1px solid #30363d;
		border-radius: 3px;
		cursor: pointer;
		font-size: 0.8em;
	}
	.btn-toggle.active {
		background: #0d2818;
		color: #3fb950;
		border-color: #3fb950;
	}
	.form-actions {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}
	.add-account-form {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 6px;
		padding: 16px;
		margin-top: 12px;
	}
	.muted { color: #8b949e; font-size: 0.9em; }
	.discovered {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 6px;
		padding: 16px;
		margin-bottom: 12px;
	}
	.discovered h3 { font-size: 0.95em; margin-bottom: 4px; }
	.discovered-account {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 0;
		border-bottom: 1px solid #21262d;
		flex-wrap: wrap;
	}
	.discovered-account:last-child { border-bottom: none; }
	.discovered-account form { display: flex; gap: 6px; align-items: center; margin-left: auto; }
	.tags { color: #8b949e; font-size: 0.8em; }
	.inline-input {
		padding: 4px 8px;
		width: 140px;
		font-size: 0.85em;
	}
	.inline-select {
		padding: 4px 8px;
		font-size: 0.85em;
	}
	.btn-sm {
		padding: 4px 10px;
		font-size: 0.85em;
	}
</style>
