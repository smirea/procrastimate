<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { sectionBadge } from 'shared/views.ts';
	import type { Task } from 'shared/task.ts';
	import { clock, motion } from '../ui.svelte.ts';

	/** `rows` are the open rows the section shows. */
	let { rows }: { rows: Task[] } = $props();

	const badge = $derived(sectionBadge(rows, clock.today));
</script>

{#if badge}
	<span
		class="mr-1 flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-[5px] text-[11px] font-semibold text-on-accent tabular-nums transition-colors {badge.due
			? 'bg-[var(--tone-overdue)]'
			: 'bg-accent'}"
		data-badge={badge.due ? 'due' : 'pending'}
		transition:fade={motion({ duration: 160 })}
	>
		{#key badge.count}
			<span class="inline-block" in:fly={motion({ y: -3, duration: 180, easing: cubicOut })}>{badge.count}</span>
		{/key}<span class="sr-only">{' '}{badge.due ? 'due or overdue' : 'open'}</span>
	</span>
{/if}
