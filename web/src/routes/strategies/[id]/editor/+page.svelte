<script lang="ts">
	import MonacoEditor from "$lib/components/MonacoEditor.svelte";
	import { page } from "$app/stores";

	let { data } = $props();
	let source = $state(data.source);
	let saving = $state(false);
	let dirty = $state(false);
	let message = $state("");
	let messageType = $state<"success" | "error">("success");

	async function save() {
		saving = true;
		message = "";
		try {
			const res = await fetch(`/api/strategies/${data.strategy.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ source }),
			});
			const result = await res.json();
			if (res.ok) {
				dirty = false;
				message = "Saved";
				messageType = "success";
				setTimeout(() => { if (message === "Saved") message = ""; }, 2000);
			} else {
				message = result.error ?? "Save failed";
				messageType = "error";
			}
		} catch {
			message = "Network error";
			messageType = "error";
		}
		saving = false;
	}

	function handleBeforeUnload(e: BeforeUnloadEvent) {
		if (dirty) e.preventDefault();
	}
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />

<div class="editor-tab">
	{#if data.strategy.isUserOwned}
		<div class="editor-toolbar">
			{#if message}
				<span class="message" class:error={messageType === "error"}>{message}</span>
			{/if}
			<button class="btn-save" onclick={save} disabled={saving || !dirty}>
				{saving ? "Saving..." : "Save"}
			</button>
		</div>
		<div class="editor-wrapper">
			<MonacoEditor
				bind:value={source}
				types={data.types}
				onchange={() => dirty = true}
				onsave={save}
			/>
		</div>
	{:else}
		<div class="readonly-notice">
			<p>This is a {data.strategy.source} strategy. Copy it to your collection to edit.</p>
		</div>
	{/if}
</div>

<style>
	.editor-tab {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 200px);
	}
	.editor-toolbar {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		margin-bottom: 8px;
		flex-shrink: 0;
	}
	.message { font-size: 0.85em; color: #3fb950; }
	.message.error { color: #f85149; }
	.btn-save {
		padding: 6px 16px;
		background: #238636;
		color: #fff;
		border: none;
		border-radius: 4px;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.85em;
	}
	.btn-save:hover { background: #2ea043; }
	.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
	.editor-wrapper {
		flex: 1;
		min-height: 0;
	}
	.editor-wrapper :global(.editor-container) {
		height: 100%;
		min-height: 0;
	}
	.readonly-notice {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 40px;
		text-align: center;
		color: #8b949e;
	}
</style>
