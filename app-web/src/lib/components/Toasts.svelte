<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { toasts } from '../ui.svelte.ts';
</script>

<div class="toasts pointer-events-none fixed left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div
			role="status"
			class="pointer-events-auto flex items-center gap-3 rounded-full bg-[var(--toast-bg)] py-2 pr-2 pl-4 text-[13px] text-white shadow-lg backdrop-blur-xl"
			animate:flip={{ duration: 200 }}
			in:fly={{ y: 16, duration: 220, easing: cubicOut }}
			out:fly={{ y: 8, duration: 160, opacity: 0 }}
		>
			<span class="max-w-[min(60vw,28rem)] truncate">{toast.message}</span>
			{#if toast.action}
				<button
					type="button"
					class="hit-area relative rounded-full px-3 py-1 font-medium text-[var(--toast-action)] transition-colors hover:bg-white/10"
					onclick={() => {
						toast.action?.run();
						toasts.dismiss(toast.id);
					}}
				>
					{toast.action.label}
				</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toasts {
		bottom: max(1.25rem, calc(env(safe-area-inset-bottom) + 0.5rem));
	}

	/* Clears the floating add button on phones. */
	@media (max-width: 767px) {
		.toasts {
			bottom: max(5.5rem, calc(env(safe-area-inset-bottom) + 4.75rem));
		}
	}
</style>
