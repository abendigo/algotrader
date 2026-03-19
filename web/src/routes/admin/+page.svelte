<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";

	let { data, form } = $props();
	let stoppingService = $state<string | null>(null);


	// Auto-refresh services every 5 seconds
	// svelte-ignore state_referenced_locally
	let servicesData = $state(data.services);
	$effect(() => {
		servicesData = data.services;
		const interval = setInterval(async () => {
			try {
				const res = await fetch("/api/admin/services");
				if (res.ok) servicesData = await res.json();
			} catch { /* ignore */ }
		}, 5000);
		return () => clearInterval(interval);
	});

	function formatUptime(ms: number | undefined): string {
		if (!ms) return "-";
		const sec = Math.floor(ms / 1000);
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}

	async function stopService(userId: string) {
		stoppingService = userId;
		try {
			await fetch("/api/admin/services", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId }),
			});
		} finally {
			stoppingService = null;
		}
	}
</script>

<div class="admin-page">
	<h1>Admin</h1>

	{#if form?.success}
		<div class="success">{form.message}</div>
	{/if}
	{#if form?.error}
		<div class="error">{form.error}</div>
	{/if}

	<section>
		<h2>Users</h2>
		<table>
			<thead>
				<tr>
					<th>Email</th>
					<th>Role</th>
					<th>API Key</th>
					<th>Registered</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.users as user}
					<tr>
						<td>{user.email}</td>
						<td>
							<span class="badge" class:admin={user.role === "admin"} class:user-badge={user.role === "user"}>
								{user.role}
							</span>
						</td>
						<td>
							{#if user.hasApiKey}
								<span class="status-set">Set</span>
							{:else}
								<span class="status-unset">Not set</span>
							{/if}
						</td>
						<td class="date">{user.createdAt.slice(0, 10)}</td>
						<td>
							<form method="POST" action="?/setRole" use:enhance={() => { return async ({ update }) => { await update(); await invalidateAll(); }; }}>
								<input type="hidden" name="userId" value={user.id} />
								{#if user.role === "admin"}
									<input type="hidden" name="role" value="user" />
									<button type="submit" class="btn-sm btn-demote">Demote</button>
								{:else}
									<input type="hidden" name="role" value="admin" />
									<button type="submit" class="btn-sm btn-promote">Promote</button>
								{/if}
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section>
		<h2>Live Services</h2>
		{#if servicesData.length === 0}
			<p class="empty">No live services running</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>User</th>
						<th>Port</th>
						<th>Uptime</th>
						<th>Stream</th>
						<th>Sessions</th>
						<th>Ticks</th>
						<th>Memory</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each servicesData as svc}
						<tr>
							<td>{svc.email}</td>
							<td class="mono">{svc.port}</td>
							<td>{formatUptime(svc.uptime)}</td>
							<td>
								{#if svc.error}
									<span class="stream-status disconnected">{svc.error}</span>
								{:else if svc.streamConnected}
									<span class="stream-status connected">Connected</span>
								{:else}
									<span class="stream-status reconnecting">Reconnecting</span>
								{/if}
							</td>
							<td>{svc.sessionCount ?? "-"}</td>
							<td>{svc.ticksReceived?.toLocaleString() ?? "-"}</td>
							<td>{svc.memoryUsage ? `${svc.memoryUsage} MB` : "-"}</td>
							<td>
								<button
									class="btn-sm btn-stop"
									disabled={stoppingService === svc.userId}
									onclick={() => stopService(svc.userId)}
								>
									{stoppingService === svc.userId ? "Stopping..." : "Stop"}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<section>
		<h2>System API Key</h2>
		<p class="section-desc">OANDA API key used for data collection. Not tied to any user account.</p>
		<div class="disk-info">
			<div class="stat-row">
				<span class="label">Status</span>
				<span class="value">
					{#if data.hasSystemApiKey}
						<span class="status-set">Configured</span>
					{:else}
						<span class="status-unset">Not set</span>
					{/if}
				</span>
			</div>
		</div>
		<form method="POST" action="?/setApiKey" use:enhance={() => { return async ({ update }) => { await update(); await invalidateAll(); }; }}>
			<div class="api-key-form">
				<input type="text" name="apiKey" autocomplete="off" data-1p-ignore placeholder="OANDA API key" class="input-key" />
				<button type="submit" class="btn-sm btn-promote">Save</button>
			</div>
		</form>
	</section>

	<section>
		<h2>Historical Data</h2>
		<div class="disk-info">
			<div class="stat-row">
				<span class="label">Disk usage</span>
				<span class="value">{data.disk.size}</span>
			</div>
			<div class="stat-row">
				<span class="label">Total files</span>
				<span class="value">{data.disk.files.toLocaleString()}</span>
			</div>
		</div>
		<a href="/admin/data" class="btn-sm btn-promote" style="display:inline-block; margin-top:8px;">Manage Data Collection</a>
	</section>

	<section>
		<h2>System</h2>
		<div class="disk-info">
			<div class="stat-row">
				<span class="label">Node.js</span>
				<span class="value mono">{typeof process !== 'undefined' ? 'Server-side' : 'N/A'}</span>
			</div>
			<div class="stat-row">
				<span class="label">Platform</span>
				<span class="value mono">SvelteKit + OANDA v20 API</span>
			</div>
		</div>
	</section>
</div>

<style>
	.admin-page h1 {
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
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88em;
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
	tr:hover td { background: #1c2128; }
	.badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 0.8em;
		font-weight: 600;
	}
	.badge.admin { background: #0d419d; color: #58a6ff; }
	.badge.user-badge { background: #21262d; color: #8b949e; }
	.status-set { color: #3fb950; font-size: 0.85em; }
	.status-unset { color: #8b949e; font-size: 0.85em; }
	.date { color: #8b949e; font-size: 0.85em; }
	.mono { font-family: monospace; font-size: 0.85em; }
	.disk-info {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 6px;
		padding: 12px 16px;
		margin-bottom: 12px;
	}
	.stat-row {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		font-size: 0.9em;
	}
	.stat-row .label { color: #8b949e; }
	.btn-sm {
		padding: 3px 8px;
		border-radius: 3px;
		font-size: 0.8em;
		cursor: pointer;
		border: 1px solid;
	}
	.btn-promote {
		background: transparent;
		color: #58a6ff;
		border-color: #58a6ff;
	}
	.btn-demote {
		background: transparent;
		color: #8b949e;
		border-color: #30363d;
	}
	.empty { color: #8b949e; font-size: 0.9em; font-style: italic; }
	.stream-status {
		font-size: 0.8em;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 3px;
	}
	.stream-status.connected { background: #0d2818; color: #3fb950; }
	.stream-status.reconnecting { background: #3d2e00; color: #d29922; }
	.stream-status.disconnected { background: #5d1a1a; color: #f85149; }
	.btn-stop {
		background: transparent;
		color: #f85149;
		border-color: #f85149;
	}
	.section-desc {
		color: #8b949e;
		font-size: 0.85em;
		margin: 0 0 8px;
	}
	.api-key-form {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 8px;
	}
	.input-key {
		flex: 1;
		padding: 6px 10px;
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 4px;
		color: #c9d1d9;
		font-size: 0.85em;
		font-family: monospace;
	}
	.input-key:focus { outline: none; border-color: #58a6ff; }
</style>
