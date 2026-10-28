<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { leaving, sheets, toasts, motion } from '../ui.svelte.ts';

	const overSheet = $derived(sheets.current.kind !== 'none');

	let stack: HTMLDivElement;
	let from: { top: number; shown: boolean } | undefined;
	let glide: Animation | undefined;

	$effect.pre(() => {
		void overSheet;
		if (stack) from = { top: stack.getBoundingClientRect().top, shown: stack.childElementCount > 0 };
	});

	/**
	 * On phones the stack jumps between the top and the bottom as a sheet opens or closes, so it glides there instead of
	 * teleporting a toast out from under a finger reaching for Undo. A toast born with the move just appears at its spot.
	 */
	$effect(() => {
		void overSheet;
		if (!from?.shown) return;
		glide?.cancel();
		const offset = from.top - stack.getBoundingClientRect().top;
		const { duration } = motion({ duration: 260 });
		if (offset && duration)
			glide = stack.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], {
				duration,
				easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
			});
	});
</script>

<div
	bind:this={stack}
	class="toasts pointer-events-none fixed inset-x-3 z-[60] flex flex-col items-center gap-2"
	data-over-sheet={overSheet}
	aria-live="polite"
>
	{#each toasts.items as toast (toast.id)}
		<div
			role="status"
			class="glass-strong pointer-events-auto flex max-w-full items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4 text-[13px] text-ink touch:text-[14px]"
			animate:flip={motion({ duration: 200 })}
			in:fly={motion({ y: 16, duration: 220, easing: cubicOut })}
			out:fly={motion({ y: 8, duration: 160, opacity: 0 })}
			{@attach leaving}
			onpointerenter={() => toasts.hold(toast.id)}
			onpointerleave={() => toasts.release(toast.id)}
			onfocusin={() => toasts.hold(toast.id)}
			onfocusout={() => toasts.release(toast.id)}
		>
			<span class="max-w-[28rem] min-w-0 truncate">{toast.message}</span>
			{#if toast.action}
				<button
					type="button"
					class="btn btn-quiet hit-area relative h-8 shrink-0 px-3.5 whitespace-nowrap text-accent touch:h-9"
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

	/* Clears the floating add button on phones. A sheet docks to the bottom there, so toasts move to the top. */
	@media (max-width: 767px) {
		.toasts {
			bottom: max(5.5rem, calc(env(safe-area-inset-bottom) + 4.75rem));
		}

		.toasts[data-over-sheet='true'] {
			top: max(0.75rem, calc(env(safe-area-inset-top) + 0.5rem));
			bottom: auto;
		}
	}
</style>
