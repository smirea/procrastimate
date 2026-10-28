<script lang="ts">
	import type { Snippet } from 'svelte';
	import Plus from 'phosphor-svelte/lib/Plus';
	import type { Screen } from 'shared/screens.ts';
	import type { Task } from 'shared/task.ts';
	import { quickAddDefaults } from '../screen.ts';
	import { sheets } from '../ui.svelte.ts';
	import CopyButton from './CopyButton.svelte';
	import PendingCount from './PendingCount.svelte';
	import SectionBadge from './SectionBadge.svelte';

	/**
	 * `counted` is off for done tasks, which are not pending, and `badge` swaps the faint count for a section's opt-in
	 * pill. `add` is the screen the heading's `+` opens quick add on.
	 */
	let {
		heading,
		tasks,
		counted = true,
		badge = false,
		add,
		title,
		class: className = '',
	}: {
		heading: string;
		tasks: Task[];
		counted?: boolean;
		badge?: boolean;
		add?: Screen;
		title?: Snippet;
		class?: string;
	} = $props();
</script>

<div class="group mb-1 flex items-center justify-between gap-2 border-b border-ink/[0.07] pr-1 pb-1.5 pl-2">
	{#if title}
		{@render title()}
	{:else}
		<h2 class="min-w-0 truncate text-[15px] font-semibold {className}">{heading}</h2>
	{/if}
	<span class="-my-1 flex items-center gap-0.5">
		{#if badge}<SectionBadge rows={tasks} />{:else if counted}<PendingCount open={tasks.length} class="mr-1 text-[12px]" />{/if}
		<span class="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
			<CopyButton
				label={`Copy ${heading} as Markdown`}
				markdown={() => ({ title: null, sections: [{ heading, tasks }] })}
				size={14}
				class="hit-area size-6!"
			/>
		</span>
		{#if add}
			<button
				type="button"
				class="icon-btn hit-area size-7! text-accent! hover:bg-accent/12!"
				aria-label={`Add task to ${heading}`}
				onclick={() => sheets.openQuickAdd(quickAddDefaults(add))}
			>
				<Plus size={20} weight="bold" />
			</button>
		{/if}
	</span>
</div>
