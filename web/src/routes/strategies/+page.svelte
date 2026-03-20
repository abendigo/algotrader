<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import { goto } from "$app/navigation";
	import { formatPct, formatFileSize, formatDate } from "$lib/utils.js";
	import Modal from "$lib/components/Modal.svelte";

	let { data, form } = $props();
	let copyingId = $state<string | null>(null);
	let showNew = $state(false);
	let newName = $state("");
	let newError = $state("");
	let creating = $state(false);

	async function createStrategy() {
		const id = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		if (!id) { newError = "Name is required"; return; }

		creating = true;
		newError = "";
		const res = await fetch(`/api/strategies/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ source: TEMPLATE.replace("My Strategy", newName.trim()).replace("my-strategy", id).replace("MyStrategy", id.split("-").map((w: string) => w[0].toUpperCase() + w.slice(1)).join("")) }),
		});
		creating = false;
		if (res.ok) {
			showNew = false;
			newName = "";
			goto(`/strategies/${id}/editor`);
		} else {
			const result = await res.json();
			newError = result.error ?? "Failed to create";
		}
	}

	const TEMPLATE = `import type { Strategy, StrategyContext, StrategyStateSnapshot } from "#core/strategy.js";
import type { Tick } from "#core/types.js";

export const strategyMeta = {
  name: "My Strategy",
  description: "A custom trading strategy.",
  recovery: { mode: "clean" as const },
  configFields: {
    common: {
      units: { label: "Units", type: "number" as const, default: 100, min: 1 },
    },
    backtest: {},
    live: {},
  },
};

export class MyStrategy implements Strategy {
  readonly name = "my-strategy";
  readonly hedging = "forbidden" as const;

  async init(ctx: StrategyContext): Promise<void> {}

  async onTick(ctx: StrategyContext, tick: Tick): Promise<void> {
    // Your strategy logic here
  }

  getState(): StrategyStateSnapshot {
    return { phase: "idle", indicators: [], positions: [] };
  }

  async dispose(): Promise<void> {}
}
`;
</script>

<div class="catalog">
	<h1>Strategies</h1>

	{#if form?.success}
		<div class="msg-success">{form.message}</div>
	{/if}
	{#if form?.error}
		<div class="msg-error">{form.error}</div>
	{/if}

	<section>
		<h2>My Strategies</h2>
		<div class="strategy-grid">
			{#each data.userStrategies as strategy}
				<a href="/strategies/{strategy.id}/editor" class="strategy-card">
					<div class="card-top">
						<span class="card-name">{strategy.name}</span>
						{#if strategy.bestReturn != null}
							<span class="card-stat" class:pos={strategy.bestReturn > 0} class:neg={strategy.bestReturn < 0}>
								{formatPct(strategy.bestReturn)} <span class="stat-label">realistic</span>
							</span>
						{/if}
					</div>
					{#if strategy.description}
						<p class="card-desc">{strategy.description}</p>
					{/if}
					<div class="card-meta">
						<span class="mono">{strategy.id}.ts</span>
						{#if strategy.fileSize != null}
							<span>{formatFileSize(strategy.fileSize)}</span>
						{/if}
						{#if strategy.modifiedAt}
							<span>{formatDate(strategy.modifiedAt)}</span>
						{/if}
						{#if strategy.backtestCount > 0}
							<span>{strategy.backtestCount} backtest{strategy.backtestCount !== 1 ? "s" : ""}</span>
						{/if}
					</div>
				</a>
			{/each}
			<button class="strategy-card new-card" onclick={() => { showNew = true; newName = ""; newError = ""; }}>
				<span class="new-icon">+</span>
				<span class="new-label">Create New Strategy</span>
			</button>
		</div>
	</section>

	{#if data.available.length > 0}
		<section>
			<h2>Available</h2>
			<p class="intro">Built-in and community strategies. Copy to customize and backtest.</p>
			<div class="strategy-grid">
				{#each data.available as strategy}
					<div class="strategy-card available-card">
						<div class="card-top">
							<span class="card-name">{strategy.name}</span>
							<span class="card-source">{strategy.source}</span>
						</div>
						{#if strategy.description}
							<p class="card-desc">{strategy.description}</p>
						{/if}
						<div class="card-actions">
							{#if strategy.alreadyCopied}
								<span class="already-copied">In your collection</span>
							{:else}
								<form method="POST" action="?/copy" use:enhance={() => { copyingId = strategy.id; return async ({ update }) => { await update(); copyingId = null; await invalidateAll(); }; }}>
									<input type="hidden" name="strategyId" value={strategy.id} />
									<button type="submit" class="btn-copy" disabled={copyingId === strategy.id}>{copyingId === strategy.id ? "Copying..." : "Copy"}</button>
								</form>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if data.userStrategies.length === 0 && data.available.length === 0}
		<p class="intro">No strategies available yet.</p>
	{/if}

	<Modal show={showNew} title="Create New Strategy" onclose={() => showNew = false}>
		<label>
			<span class="modal-label">Strategy name</span>
			<input type="text" bind:value={newName} placeholder="my-strategy"
				onkeydown={(e) => { if (e.key === "Enter") createStrategy(); }} />
		</label>
		{#if newError}
			<p class="modal-error">{newError}</p>
		{/if}
		<div class="modal-actions">
			<button class="btn-action" onclick={() => showNew = false}>Cancel</button>
			<button class="btn-primary" onclick={createStrategy} disabled={!newName.trim() || creating}>
				{creating ? "Creating..." : "Create"}
			</button>
		</div>
	</Modal>
</div>

<style>
	h1 { font-size: 1.4em; margin-bottom: 16px; }
	h2 { font-size: 1.1em; color: var(--text-secondary); border-bottom: 1px solid var(--border); padding-bottom: 6px; margin: 24px 0 12px; }
	h2:first-of-type { margin-top: 0; }
	.intro { color: var(--text-secondary); font-size: 0.9em; margin-bottom: 12px; }
	:global(.msg-success), :global(.msg-error) { margin-bottom: 16px; }

	.strategy-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 12px;
	}
	.strategy-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 16px;
		text-decoration: none;
		color: var(--text-primary);
		transition: border-color 0.15s;
	}
	.strategy-card:hover {
		border-color: var(--accent);
		text-decoration: none;
	}
	.available-card {
		cursor: default;
	}
	.available-card:hover {
		border-color: var(--border);
	}
	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.card-name { font-weight: 600; font-size: 1em; }
	.card-stat { font-size: 0.9em; font-weight: 600; }
	.stat-label { font-weight: 400; color: var(--text-muted); font-size: 0.8em; }
	.card-source { font-size: 0.75em; color: var(--text-secondary); text-transform: uppercase; }
	.card-desc {
		color: var(--text-secondary);
		font-size: 0.85em;
		line-height: 1.4;
		margin: 0 0 8px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.card-meta {
		display: flex;
		gap: 12px;
		font-size: 0.8em;
		color: var(--text-muted);
	}
	.card-actions {
		margin-top: 8px;
	}
	.already-copied { color: var(--success); font-size: 0.85em; }
	.btn-copy {
		padding: 4px 12px;
		background: var(--btn-primary-bg);
		color: #fff;
		border: none;
		border-radius: 4px;
		font-weight: 600;
		font-size: 0.82em;
		cursor: pointer;
	}
	.btn-copy:hover { background: var(--btn-primary-hover); }
	.new-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 2px dashed var(--border-light);
		background: transparent;
		cursor: pointer;
		min-height: 100px;
		color: var(--text-secondary);
		font-size: 0.9em;
	}
	.new-card:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.new-icon {
		font-size: 2em;
		line-height: 1;
	}
	.new-label {
		font-weight: 600;
	}
	.modal-label { display: block; font-size: 0.85em; color: var(--text-secondary); margin-bottom: 4px; }
	.modal-error { color: var(--danger); font-size: 0.85em; margin-top: 6px; }
	.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
	.btn-action { padding: 4px 10px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-light); border-radius: 4px; font-size: 0.82em; cursor: pointer; }
	.btn-action:hover { background: var(--border-light); }
	.btn-primary { padding: 6px 16px; background: var(--btn-primary-bg); color: #fff; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.85em; }
	.btn-primary:hover { background: var(--btn-primary-hover); }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
