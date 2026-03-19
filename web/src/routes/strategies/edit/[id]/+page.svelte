<script lang="ts">
	import MonacoEditor from "$lib/components/MonacoEditor.svelte";

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
			const res = await fetch(`/api/strategies/${data.strategyId}`, {
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
		} catch (e) {
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

<div class="editor-page">
	<div class="toolbar">
		<a href="/strategies/mine" class="back-link">My Strategies</a>
		<span class="separator">/</span>
		<h1>{data.strategyId}.ts</h1>
		<div class="toolbar-right">
			{#if message}
				<span class="message" class:error={messageType === "error"}>{message}</span>
			{/if}
			<button class="btn-save" onclick={save} disabled={saving || !dirty}>
				{saving ? "Saving..." : "Save"}
			</button>
		</div>
	</div>
	<div class="editor-wrapper">
		<MonacoEditor
			bind:value={source}
			types={data.types}
			onchange={() => dirty = true}
			onsave={save}
		/>
	</div>
</div>

<style>
	.editor-page {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 60px);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		border-bottom: 1px solid #21262d;
		flex-shrink: 0;
	}
	.back-link {
		color: #58a6ff;
		font-size: 0.9em;
	}
	.separator {
		color: #484f58;
	}
	h1 {
		font-size: 1em;
		font-weight: 600;
		margin: 0;
		font-family: monospace;
	}
	.toolbar-right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.message {
		font-size: 0.85em;
		color: #3fb950;
	}
	.message.error {
		color: #f85149;
	}
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
	.btn-save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.editor-wrapper {
		flex: 1;
		min-height: 0;
	}
	.editor-wrapper :global(.editor-container) {
		height: 100%;
		min-height: 0;
		border: none;
		border-radius: 0;
	}
</style>
