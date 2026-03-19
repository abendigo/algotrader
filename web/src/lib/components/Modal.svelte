<script lang="ts">
	interface Props {
		show: boolean;
		title: string;
		onclose: () => void;
		children: any;
	}
	let { show = $bindable(), title, onclose, children }: Props = $props();
</script>

{#if show}
	<div class="modal-backdrop" role="none" onclick={onclose}>
		<div class="modal" role="none" onclick={(e) => e.stopPropagation()}>
			<h3>{title}</h3>
			{@render children()}
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed; inset: 0; background: var(--modal-backdrop);
		display: flex; align-items: center; justify-content: center; z-index: 100;
	}
	.modal {
		background: var(--modal-bg); border: 1px solid var(--border-light); border-radius: 8px;
		padding: 24px; min-width: 340px; max-width: 440px;
	}
	.modal h3 { margin: 0 0 12px; font-size: 1em; }
</style>
