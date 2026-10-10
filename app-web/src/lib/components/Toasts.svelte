<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { toasts, motion } from '../ui.svelte.ts';
</script>

<div class="toasts pointer-events-none fixed left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div
			role="status"
			class="glass-strong pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4 text-[13px] text-ink touch:text-[14px]"
			animate:flip={motion({ duration: 200 })}
			in:fly={motion({ y: 16, duration: 220, easing: cubicOut })}
			out:fly={motion({ y: 8, duration: 160, opacity: 0 })}
		>
			<span class="max-w-[min(60vw,28rem)] truncate">{toast.message}</span>
			{#if toast.action}
				<button
					type="button"
					class="btn btn-quiet hit-area relative h-8 px-3.5 text-accent touch:h-9"
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
