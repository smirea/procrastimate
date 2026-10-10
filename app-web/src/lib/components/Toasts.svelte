<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { toasts } from '../ui.svelte.ts';
</script>

<div class="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div
			role="status"
			class="pointer-events-auto flex items-center gap-3 rounded-full bg-zinc-900/85 py-2 pr-2 pl-4 text-[13px] text-white shadow-lg backdrop-blur-xl"
			animate:flip={{ duration: 200 }}
			in:fly={{ y: 16, duration: 220, easing: cubicOut }}
			out:fly={{ y: 8, duration: 160, opacity: 0 }}
		>
			<span class="max-w-[60vw] truncate">{toast.message}</span>
			{#if toast.action}
				<button
					type="button"
					class="rounded-full px-3 py-1 font-medium text-[#ff9f8a] transition-colors hover:bg-white/10"
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
