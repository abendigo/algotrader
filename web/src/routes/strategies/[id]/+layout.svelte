<script lang="ts">
	import { page } from "$app/stores";
	import { invalidateAll } from "$app/navigation";

	let { data, children } = $props();

	const tabs = [
		{ label: "Editor", path: "editor" },
		{ label: "Backtests", path: "backtests" },
		{ label: "Paper", path: "paper" },
		{ label: "Live", path: "live" },
	];

	const activeTab = $derived(
		tabs.find((t) => $page.url.pathname.endsWith(`/${t.path}`))?.path ?? "editor",
	);

	// Fork/Delete/Revert/Share state
	let forkTarget = $state(false);
	let forkName = $state("");
	let showDelete = $state(false);
	let showRevert = $state(false);
	let actionMessage = $state("");
	let actionError = $state("");

	async function forkStrategy() {
		if (!forkName) return;
		actionMessage = "";
		actionError = "";
		const res = await fetch(`/api/strategies/${data.strategy.id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "fork", newId: forkName }),
		});
		const result = await res.json();
		if (res.ok) {
			actionMessage = `Forked to ${forkName}.ts`;
			forkTarget = false;
			forkName = "";
			window.location.href = `/strategies/${result.id}/editor`;
		} else {
			actionError = result.error;
		}
	}

	async function deleteStrategy() {
		actionMessage = "";
		actionError = "";
		const res = await fetch(`/api/strategies/${data.strategy.id}`, { method: "DELETE" });
		const result = await res.json();
		if (res.ok) {
			window.location.href = "/strategies";
		} else {
			actionError = result.error;
		}
	}

	async function revertStrategy() {
		actionMessage = "";
		actionError = "";
		const res = await fetch(`/api/strategies/${data.strategy.id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "revert" }),
		});
		const result = await res.json();
		if (res.ok) {
			actionMessage = "Reverted to original";
			showRevert = false;
			await invalidateAll();
		} else {
			actionError = result.error;
		}
	}

	async function shareStrategy() {
		actionMessage = "";
		actionError = "";
		const res = await fetch(`/api/strategies/${data.strategy.id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "share" }),
		});
		const result = await res.json();
		if (res.ok) {
			actionMessage = "Shared to community";
		} else {
			actionError = result.error;
		}
	}
</script>

<div class="strategy-detail">
	<div class="strategy-header">
		<div class="header-left">
			<a href="/strategies" class="back-link">Strategies</a>
			<span class="sep">/</span>
			<h1>{data.strategy.name}</h1>
			{#if data.strategy.fileSize != null}
				<span class="file-meta">
					{data.strategy.fileSize < 1024 ? `${data.strategy.fileSize} B` : `${(data.strategy.fileSize / 1024).toFixed(1)} KB`}
					{#if data.strategy.modifiedAt}
						· {new Date(data.strategy.modifiedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
					{/if}
				</span>
			{/if}
		</div>
		{#if data.strategy.isUserOwned}
			<div class="header-actions">
				<button class="btn-action" onclick={() => { forkTarget = true; forkName = data.strategy.id + "-v2"; }}>Fork</button>
				{#if data.isAdmin}
					<button class="btn-action btn-share" onclick={shareStrategy}>Share</button>
				{/if}
				{#if data.strategy.revertable}
					<button class="btn-action btn-warn" onclick={() => showRevert = true}>Revert</button>
				{/if}
				<button class="btn-action btn-danger" onclick={() => showDelete = true}>Delete</button>
			</div>
		{/if}
	</div>

	{#if actionMessage}
		<div class="success">{actionMessage}</div>
	{/if}
	{#if actionError}
		<div class="error">{actionError}</div>
	{/if}

	<div class="tab-bar">
		{#each tabs as tab}
			<a
				href="/strategies/{data.strategy.id}/{tab.path}"
				class="tab"
				class:active={activeTab === tab.path}
			>{tab.label}{#if tab.path === "backtests" && data.reports.length > 0} <span class="tab-count">{data.reports.length}</span>{/if}</a>
		{/each}
	</div>

	<div class="tab-content">
		{@render children()}
	</div>

	{#if forkTarget}
		<div class="modal-backdrop" onclick={() => forkTarget = false}>
			<div class="modal" onclick={(e) => e.stopPropagation()}>
				<h3>Fork {data.strategy.id}.ts</h3>
				<label>
					<span>New strategy name</span>
					<input type="text" bind:value={forkName} placeholder="my-strategy-v2"
						onkeydown={(e) => { if (e.key === "Enter") forkStrategy(); }} />
				</label>
				<div class="modal-actions">
					<button class="btn-action" onclick={() => forkTarget = false}>Cancel</button>
					<button class="btn-primary" onclick={forkStrategy} disabled={!forkName}>Fork</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showDelete}
		<div class="modal-backdrop" onclick={() => showDelete = false}>
			<div class="modal" onclick={(e) => e.stopPropagation()}>
				<h3>Delete {data.strategy.id}.ts?</h3>
				<p class="modal-warning">This cannot be undone.</p>
				<div class="modal-actions">
					<button class="btn-action" onclick={() => showDelete = false}>Cancel</button>
					<button class="btn-primary btn-danger" onclick={deleteStrategy}>Delete</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showRevert}
		<div class="modal-backdrop" onclick={() => showRevert = false}>
			<div class="modal" onclick={(e) => e.stopPropagation()}>
				<h3>Revert {data.strategy.id}.ts?</h3>
				<p class="modal-warning">This will overwrite your version with the original.</p>
				<div class="modal-actions">
					<button class="btn-action" onclick={() => showRevert = false}>Cancel</button>
					<button class="btn-primary btn-warn" onclick={revertStrategy}>Revert</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.strategy-detail {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 96px);
	}
	.strategy-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.back-link { color: #58a6ff; font-size: 0.9em; }
	.sep { color: #484f58; }
	h1 { font-size: 1.2em; margin: 0; }
	.file-meta { color: #8b949e; font-size: 0.85em; }
	.header-actions { display: flex; gap: 6px; }
	.btn-action {
		padding: 4px 10px;
		background: #21262d;
		color: #c9d1d9;
		border: 1px solid #30363d;
		border-radius: 4px;
		font-size: 0.82em;
		cursor: pointer;
	}
	.btn-action:hover { background: #30363d; }
	.btn-share { color: #a371f7; border-color: #a371f7; }
	.btn-share:hover { background: #2a1a4a; }
	.btn-warn { color: #d29922; border-color: #d29922; }
	.btn-warn:hover { background: #2a2000; }
	.btn-danger { color: #f85149; border-color: #f85149; }
	.btn-danger:hover { background: #3d1a1a; }
	.btn-primary {
		padding: 6px 16px;
		background: #238636;
		color: #fff;
		border: none;
		border-radius: 4px;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.85em;
	}
	.btn-primary:hover { background: #2ea043; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-primary.btn-danger { background: #da3633; }
	.btn-primary.btn-danger:hover { background: #f85149; }
	.btn-primary.btn-warn { background: #9e6a03; }
	.btn-primary.btn-warn:hover { background: #d29922; }
	.success {
		background: #0d2818; color: #3fb950;
		padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 8px;
	}
	.error {
		background: #5d1a1a; color: #f85149;
		padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 8px;
	}
	.tab-bar {
		display: flex;
		gap: 0;
		border-bottom: 1px solid #21262d;
		margin-bottom: 0;
		flex-shrink: 0;
	}
	.tab {
		padding: 8px 16px;
		font-size: 0.9em;
		color: #8b949e;
		border-bottom: 2px solid transparent;
		text-decoration: none;
	}
	.tab:hover { color: #c9d1d9; text-decoration: none; }
	.tab.active {
		color: #c9d1d9;
		border-bottom-color: #58a6ff;
	}
	.tab-count {
		background: #21262d;
		color: #8b949e;
		padding: 1px 6px;
		border-radius: 10px;
		font-size: 0.8em;
		margin-left: 4px;
	}
	.tab-content {
		flex: 1;
		min-height: 0;
		padding-top: 16px;
	}
	.modal-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.6);
		display: flex; align-items: center; justify-content: center; z-index: 100;
	}
	.modal {
		background: #161b22; border: 1px solid #30363d; border-radius: 8px;
		padding: 24px; min-width: 340px; max-width: 440px;
	}
	.modal h3 { margin: 0 0 12px; font-size: 1em; }
	.modal label span { display: block; font-size: 0.85em; color: #8b949e; margin-bottom: 4px; }
	.modal input[type="text"] {
		width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d;
		border-radius: 4px; color: #c9d1d9; font-size: 0.9em; box-sizing: border-box;
	}
	.modal input:focus { outline: none; border-color: #58a6ff; }
	.modal-warning { color: #8b949e; font-size: 0.85em; margin: 8px 0; }
	.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>
