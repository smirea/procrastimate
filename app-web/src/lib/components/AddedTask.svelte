<script lang="ts" module>
	/** Where the card sits: above the phone's quick add sheet, below the desktop one, or beside the details it opened. */
	export type AddedPlacement = 'above' | 'below' | 'beside' | 'floating';

	/** The rect and text size of the card's title, which the next card that shows the task grows out of. */
	export function titleOrigin(node: Element | null | undefined) {
		const text = node?.querySelector('[data-row-text]');
		if (!text) return null;
		return { rect: text.getBoundingClientRect(), size: ROW_TEXT, card: true };
	}

	const ROW_TEXT = 14;
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import { addedName, addedScreen } from 'shared/screens.ts';
	import TaskRow from './TaskRow.svelte';
	import { store } from '../store.svelte.ts';
	import { clock } from '../clock.svelte.ts';
	import { currentScreen } from '../screen.ts';
	import { leaving, motion } from '../motion.ts';
	import { sheets, type Added } from '../sheets.svelte.ts';

	let { added, placement, onclose }: { added: Added; placement: AddedPlacement; onclose?: () => void } = $props();

	/**
	 * One entry, keyed by task, so a new save's card arrives while the last one's leaves showing its own task. Only a new
	 * task makes a new entry: the origin is read once, as the card arrives, and a card that is leaving must not update.
	 */
	const shown = $derived.by(() => {
		const id = added.id;
		return [{ id, from: untrack(() => added.from) }];
	});

	const SPRING = 'linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017 19.4%, 1.067, 1.099 24.3%, 1.108 26%, 1.103 28.2%, 1.074 31.6%, 1.012 39.6%, 0.995 43.4%, 0.988 47.3%, 0.993 59.4%, 1)';

	/** Where a card comes in from when no text precedes it. */
	const enterFrom: Record<AddedPlacement, string> = {
		above: 'translateY(12px) scale(0.96)',
		below: 'translateY(-12px) scale(0.96)',
		beside: 'translateX(28px) scale(0.96)',
		floating: 'translateY(24px) scale(0.96)',
	};

	/**
	 * The card grows out of the text it came from: its title starts where that text sat, at that text's size, and springs
	 * into place while the card's glass fades in around it.
	 */
	function arrive(from: Added['from']) {
		return (node: HTMLElement) => untrack(() => {
			const { duration } = motion({ duration: 560 });
			if (!duration) return;
			const glass = node.querySelector<HTMLElement>('[data-glass]');
			const text = node.querySelector('[data-row-text]');
			if (from && text) {
				const to = text.getBoundingClientRect();
				const scale = from.size / ROW_TEXT;
				const origin = `${to.left - node.getBoundingClientRect().left}px ${to.top - node.getBoundingClientRect().top}px`;
				node.animate(
					[
						{ transform: `translate(${from.rect.left - to.left}px, ${from.rect.top - to.top}px) scale(${scale})`, transformOrigin: origin },
						{ transform: 'none', transformOrigin: origin },
					],
					{ duration, easing: SPRING },
				);
				// From another card the whole card moves; only typed text grows its glass and lines on the way.
				if (from.card) return;
				glass?.animate([{ opacity: 0, scale: '0.97' }, { opacity: 1, scale: '1' }], { duration: duration * 0.6, delay: duration * 0.12, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'backwards' });
				// The title is the text that flew; the lines under it fade in once it lands.
				for (const line of node.querySelectorAll('[data-row-text] > :last-child > :not(:first-child)'))
					line.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * 0.5, delay: duration * 0.3, fill: 'backwards' });
			} else {
				node.animate([{ transform: enterFrom[placement], opacity: 0 }, { transform: 'none', opacity: 1 }], { duration, easing: SPRING });
			}
		});
	}

	const leaveY = $derived(placement === 'below' ? 10 : placement === 'beside' ? 0 : -10);

	function where(id: string) {
		const task = store.task(id);
		const screen = task ? addedScreen(currentScreen(), task, store.labels, clock.today) : null;
		return screen ? `Added to ${addedName(screen, store.projects)}` : 'Added task';
	}
</script>

<div class="added grid" data-placement={placement}>
	{#each shown as entry (entry.id)}
		{@const task = store.task(entry.id)}
		<!-- An untitled task expanded into details has nothing to show until it is named. -->
		{#if task?.title}
			<div
				class="relative [grid-area:1/1] will-change-transform"
				role="status"
				aria-label={where(entry.id)}
				data-added-task={task.title}
				onclickcapture={(event) => {
					// Opening its details from the card moves the card there, growing out of where it sat.
					if (sheets.added?.id === entry.id) sheets.added.from = titleOrigin(event.currentTarget);
				}}
				{@attach arrive(entry.from)}
				{@attach leaving}
				out:fly={motion({ y: leaveY, x: placement === 'beside' ? 16 : 0, duration: 200, easing: cubicOut, opacity: 0 })}
			>
				<div class="glass-strong absolute inset-0 rounded-[1.375rem]" data-glass></div>
				<div class="relative flex items-start py-0.5 pr-1 pl-2.5">
					<div class="min-w-0 flex-1">
						<TaskRow {task} card showProject />
					</div>
					{#if onclose}
						<button
							type="button"
							class="hit-area mt-1.5 grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink"
							aria-label="Close preview"
							onclick={onclose}
						>
							<X size={14} weight="bold" />
						</button>
					{/if}
				</div>
			</div>
		{/if}
	{/each}
</div>

<style>
	.added[data-placement='above'] {
		align-items: end;
	}
</style>
