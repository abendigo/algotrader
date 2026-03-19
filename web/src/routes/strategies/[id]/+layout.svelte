<script lang="ts">
	import { page } from "$app/stores";
	import { invalidateAll } from "$app/navigation";
	import { formatDate, formatFileSize } from "$lib/utils.js";
	import Modal from "$lib/components/Modal.svelte";

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

	let sharing = $state(false);

	async function shareStrategy() {
		sharing = true;
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
		sharing = false;
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
					{formatFileSize(data.strategy.fileSize)}
					{#if data.strategy.modifiedAt}
						· {formatDate(data.strategy.modifiedAt)}
					{/if}
				</span>
			{/if}
		</div>
		{#if data.strategy.isUserOwned}
			<div class="header-actions">
				<button class="btn-action" onclick={() => { forkTarget = true; forkName = data.strategy.id + "-v2"; }}>Fork</button>
				{#if data.isAdmin}
					<button class="btn-action btn-share" onclick={shareStrategy} disabled={sharing}>{sharing ? "Sharing..." : "Share"}</button>
				{/if}
				{#if data.strategy.revertable}
					<button class="btn-action btn-warn" onclick={() => showRevert = true}>Revert</button>
				{/if}
				<button class="btn-action btn-danger" onclick={() => showDelete = true}>Delete</button>
			</div>
		{/if}
	</div>

	{#if actionMessage}
		<div class="msg-success">{actionMessage}</div>
	{/if}
	{#if actionError}
		<div class="msg-error">{actionError}</div>
	{/if}

	<div class="tab-bar">
		{#each tabs as tab}
			<a
				href="/strategies/{data.strategy.id}/{tab.path}"
				class="tab"
				class:active={activeTab === tab.path}
			>{tab.label}{#if tab.path === "backtests" && data.reports.length > 0} <span class="tab-count">{data.reports.length}</span>{/if}{#if tab.path === "paper" && data.pastSessions.length > 0} <span class="tab-count">{data.pastSessions.length}</span>{/if}</a>
		{/each}
	</div>

	<div class="tab-content">
		{@render children()}
	</div>

	<Modal show={!!forkTarget} title="Fork {data.strategy.id}.ts" onclose={() => forkTarget = false}>
		<label>
			<span>New strategy name</span>
			<input type="text" bind:value={forkName} placeholder="my-strategy-v2"
				onkeydown={(e) => { if (e.key === "Enter") forkStrategy(); }} />
		</label>
		<div class="modal-actions">
			<button class="btn-action" onclick={() => forkTarget = false}>Cancel</button>
			<button class="btn-primary" onclick={forkStrategy} disabled={!forkName}>Fork</button>
		</div>
	</Modal>

	<Modal show={showDelete} title="Delete {data.strategy.id}.ts?" onclose={() => showDelete = false}>
		<p class="modal-warning">This cannot be undone.</p>
		<div class="modal-actions">
			<button class="btn-action" onclick={() => showDelete = false}>Cancel</button>
			<button class="btn-primary btn-danger" onclick={deleteStrategy}>Delete</button>
		</div>
	</Modal>

	<Modal show={showRevert} title="Revert {data.strategy.id}.ts?" onclose={() => showRevert = false}>
		<p class="modal-warning">This will overwrite your version with the original.</p>
		<div class="modal-actions">
			<button class="btn-action" onclick={() => showRevert = false}>Cancel</button>
			<button class="btn-primary btn-warn" onclick={revertStrategy}>Revert</button>
		</div>
	</Modal>
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
	.back-link { color: var(--accent); font-size: 0.9em; }
	.sep { color: var(--text-muted); }
	h1 { font-size: 1.2em; margin: 0; }
	.file-meta { color: var(--text-secondary); font-size: 0.85em; }
	.header-actions { display: flex; gap: 6px; }
	.btn-action {
		padding: 4px 10px;
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border-light);
		border-radius: 4px;
		font-size: 0.82em;
		cursor: pointer;
	}
	.btn-action:hover { background: var(--border-light); }
	.btn-share { color: var(--purple); border-color: var(--purple); }
	.btn-share:hover { background: var(--purple-bg); }
	.btn-warn { color: var(--warning); border-color: var(--warning); }
	.btn-warn:hover { background: var(--warning-bg); }
	.btn-danger { color: var(--danger); border-color: var(--danger); }
	.btn-danger:hover { background: var(--danger-bg); }
	.btn-primary {
		padding: 6px 16px;
		background: var(--btn-primary-bg);
		color: #fff;
		border: none;
		border-radius: 4px;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.85em;
	}
	.btn-primary:hover { background: var(--btn-primary-hover); }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-primary.btn-danger { background: var(--danger); }
	.btn-primary.btn-danger:hover { background: var(--danger); }
	.btn-primary.btn-warn { background: var(--warning); }
	.btn-primary.btn-warn:hover { background: var(--warning); }
	:global(.msg-success), :global(.msg-error) { margin-bottom: 8px; }
	.tab-bar {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0;
		flex-shrink: 0;
	}
	.tab {
		padding: 8px 16px;
		font-size: 0.9em;
		color: var(--text-secondary);
		border-bottom: 2px solid transparent;
		text-decoration: none;
	}
	.tab:hover { color: var(--text-primary); text-decoration: none; }
	.tab.active {
		color: var(--text-primary);
		border-bottom-color: var(--accent);
	}
	.tab-count {
		background: var(--bg-tertiary);
		color: var(--text-secondary);
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
	label span { display: block; font-size: 0.85em; color: var(--text-secondary); margin-bottom: 4px; }
	label input[type="text"] {
		width: 100%; padding: 8px 10px; font-size: 0.9em; box-sizing: border-box;
	}
	.modal-warning { color: var(--text-secondary); font-size: 0.85em; margin: 8px 0; }
	.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>
