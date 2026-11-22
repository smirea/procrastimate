<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { ReactionGroup } from 'shared/reactions.ts';
	import { motion } from '../motion.ts';
	import { session } from '../session.svelte.ts';
	import { store } from '../store.svelte.ts';

	/** `editable` lets a chip take back or switch to its emoji, since each person has one reaction per task. */
	let { taskId, groups, editable }: { taskId: string; groups: ReactionGroup[]; editable: boolean } = $props();

	const nameOf = (id: string) => (id === session.userId ? 'You' : (store.person(id)?.name ?? 'Someone'));
</script>

<div {@attach feedback()} class="flex shrink-0 items-center gap-1 pt-2.5 touch:pt-3" role="group" aria-label="Reactions">
	{#each groups as group (group.emoji)}
		{@const mine = group.authorIds.includes(session.userId ?? '')}
		{@const names = group.authorIds.map(nameOf).join(', ')}
		<span class="chip-wrap relative" in:scale={motion({ start: 0.6, duration: 180, easing: cubicOut })}>
			<button
				type="button"
				class="chip flex h-6 items-center gap-1 rounded-full px-1.5 text-[13px] touch:h-8 touch:px-2 touch:text-[15px] leading-none transition-colors"
				class:mine
				aria-pressed={mine}
				aria-label={`${group.emoji} ${names}`}
				disabled={!editable}
				onclick={() => store.react(taskId, group.emoji)}
			>
				<span>{group.emoji}</span>
				{#if group.authorIds.length > 1}<span class="text-[11px] font-medium text-muted tabular-nums">{group.authorIds.length}</span>{/if}
			</button>
			<span role="tooltip" class="tip glass-strong pointer-events-none absolute right-0 bottom-full z-30 mb-1.5 rounded-lg px-2 py-1 text-[12px] whitespace-nowrap text-ink">
				{names}
			</span>
		</span>
	{/each}
</div>

<style>
	.chip {
		background: color-mix(in srgb, var(--color-ink) 5%, transparent);
	}

	.chip:enabled:hover {
		background: color-mix(in srgb, var(--color-ink) 9%, transparent);
	}

	.chip.mine {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.chip:disabled {
		cursor: default;
	}

	.tip {
		opacity: 0;
		translate: 0 2px;
		transition:
			opacity 120ms,
			translate 120ms;
	}

	.chip-wrap:hover .tip,
	.chip-wrap:focus-within .tip {
		opacity: 1;
		translate: 0 0;
	}
</style>
