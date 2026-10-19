<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Task } from 'shared/task.ts';
	import { filterActive, filterTasks, NO_FILTER } from 'shared/list-filters.ts';
	import AddTaskButton from './AddTaskButton.svelte';
	import FilterMenu from './FilterMenu.svelte';
	import PendingCount from './PendingCount.svelte';
	import { listFilters } from '../list-filters.svelte.ts';
	import { session } from '../session.svelte.ts';
	import { motion } from '../ui.svelte.ts';

	let {
		name,
		title,
		subtitle,
		open,
		empty,
		emptyTitle,
		emptyHint,
		canAdd = true,
		filter,
		actions,
		children,
		after,
	}: {
		/** What the view is called: the heading, unless `title` renders one. */
		name: string;
		title?: Snippet;
		subtitle?: string;
		/** The open rows the view lists, for the count beside the title. */
		open?: number;
		empty: boolean;
		emptyTitle: string;
		emptyHint: string;
		canAdd?: boolean;
		/** The list's filter key and its open rows before filtering, for the filter menu at the top left. */
		filter?: { list: string; tasks: Task[] };
		/** The top right: the list's `…` menu, after any control it keeps in sight. */
		actions: Snippet;
		children: Snippet;
		/** Below the add button and the empty state, such as a view's completed tasks. */
		after?: Snippet;
	} = $props();

	/** The filter hid every row, which reads differently from a list with nothing in it. */
	const filteredOut = $derived(
		!!filter && filter.tasks.length > 0 && filterActive(listFilters.get(filter.list)) &&
			filterTasks(filter.tasks, listFilters.get(filter.list), session.userId ?? '').length === 0,
	);
</script>

<section in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}>
	<header class="mb-5 flex items-end justify-between gap-4">
		<div class="flex min-w-0 items-end gap-1.5">
			{#if filter}<div class="-ml-2 shrink-0"><FilterMenu list={filter.list} tasks={filter.tasks} /></div>{/if}
			<div class="min-w-0">
			<div class="flex min-w-0 items-baseline gap-2.5">
				{#if title}
					{@render title()}
				{:else}
					<h1 class="truncate text-[26px] font-semibold tracking-tight">{name}</h1>
				{/if}
				{#if open !== undefined}<PendingCount {open} class="text-[15px]" />{/if}
			</div>
			{#if subtitle}<p class="mt-0.5 text-[13px] text-muted">{subtitle}</p>{/if}
			</div>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			{@render actions()}
		</div>
	</header>

	{@render children()}

	{#if canAdd}
		<AddTaskButton />
	{/if}

	{#if filteredOut && filter}
		<div class="mt-16 text-center" in:fade={motion({ duration: 240, delay: 120 })}>
			<p class="text-[15px] font-medium">No tasks match the filters</p>
			<button type="button" class="btn btn-quiet mt-3" onclick={() => listFilters.set(filter.list, NO_FILTER)}>Clear filters</button>
		</div>
	{:else if empty}
		<div class="mt-16 text-center" in:fade={motion({ duration: 240, delay: 120 })}>
			<p class="text-[15px] font-medium">{emptyTitle}</p>
			<p class="mt-1 text-[13px] text-muted">{emptyHint}</p>
		</div>
	{/if}

	{@render after?.()}
</section>
