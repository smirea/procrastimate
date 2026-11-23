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

<!-- Last in the row and as tall as it, padding included, so each emoji is a full-height target with no pill behind it. -->
<div {@attach feedback()} class="flex shrink-0 items-stretch self-stretch" role="group" aria-label="Reactions">
	{#each groups as group (group.emoji)}
		{@const mine = group.authorIds.includes(session.userId ?? '')}
		{@const names = group.authorIds.map(nameOf).join(', ')}
		<button
			type="button"
			class="reaction flex items-center gap-1 rounded-xl px-1.5 text-[20px] leading-none transition-colors touch:min-w-11 touch:justify-center touch:text-[22px]"
			class:mine
			aria-pressed={mine}
			aria-label={`${group.emoji} ${names}`}
			data-tooltip={names}
			disabled={!editable}
			onclick={() => store.react(taskId, group.emoji)}
			in:scale={motion({ start: 0.6, duration: 180, easing: cubicOut })}
		>
			<span>{group.emoji}</span>
			{#if group.authorIds.length > 1}<span class="text-[12px] font-medium text-muted tabular-nums">{group.authorIds.length}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.reaction:enabled:hover {
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
	}

	.reaction.mine {
		box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-accent) 55%, transparent);
	}

	.reaction:disabled {
		cursor: default;
	}
</style>
