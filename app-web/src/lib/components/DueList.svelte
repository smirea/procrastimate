<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import View from './View.svelte';
	import TaskList from './TaskList.svelte';
	import SectionHeading from './SectionHeading.svelte';
	import { store } from '../store.svelte.ts';
	import AddTaskButton from './AddTaskButton.svelte';
	import ListMenu from './ListMenu.svelte';
	import { listFilters } from '../list-filters.svelte.ts';
	import { session } from '../session.svelte.ts';
	import { clock, leaving, motion } from '../ui.svelte.ts';
	import type { DateKey } from 'shared/task.ts';
	import { filterKey } from 'shared/list-filters.ts';
	import { listHeader } from 'shared/list-header.ts';
	import type { Screen } from 'shared/screens.ts';
	import { dueDays, type DueDays, type DueList } from 'shared/views.ts';
	import { dayHeading } from 'shared/format.ts';

	let { list, name, emptyTitle, emptyHint }: { list: DueList; name: string; emptyTitle: string; emptyHint: string } = $props();

	const key = $derived(filterKey({ kind: list }));
	const all = $derived(dueDays(store.own.tasks, clock.today, list));
	const due = $derived(dueDays(store.own.tasks, clock.today, list, { filter: listFilters.get(key), me: session.userId ?? '' }));
	const rows = (days: DueDays) => [...days.overdue, ...days.today, ...days.days.flatMap((group) => group.tasks)];
	/** A subtask the filter surfaces, because it hides the parent, joins the menu's rows so the menu counts it. */
	const unfiltered = $derived([...new Set([...rows(all), ...rows(due)])]);
	const empty = $derived(all.overdue.length + all.today.length + all.days.length === 0);
	const sections = $derived([
		{ heading: 'Overdue', tasks: due.overdue },
		{ heading: 'Today', tasks: due.today },
		...due.days.map(group => ({ heading: dayHeading(group.date, clock.today), tasks: group.tasks })),
	]);
	/** Tomorrow is one day, which its title already names. */
	const headed = $derived(list !== 'tomorrow');
	const screenOn = (date: DateKey): Screen => (list === 'tomorrow' ? { kind: 'tomorrow' } : { kind: list, date });
</script>

<svelte:head><title>{name} · ProcrastiMate</title></svelte:head>

<View
	{name}
	open={sections.reduce((n, s) => n + s.tasks.length, 0)}
	{empty}
	{emptyTitle}
	{emptyHint}
	canAdd={empty}
	filter={{ list: key, tasks: unfiltered }}
>
	{#snippet actions()}
		<ListMenu
			header={listHeader({ kind: list })}
			label={`${name} actions`}
			markdown={() => ({ title: name, sections: headed ? sections : [{ heading: null, tasks: sections.flatMap(s => s.tasks) }] })}
		/>
	{/snippet}
	{#if due.overdue.length}
		<section class="mb-6" aria-label="Overdue">
			<SectionHeading heading="Overdue" tasks={due.overdue} class="text-[var(--tone-overdue)]" />
			<TaskList tasks={due.overdue} showProject="assigned" label="Overdue tasks" />
		</section>
	{/if}
	{#if due.today.length}
		<section class="mb-6" aria-label="Today">
			<SectionHeading heading="Today" tasks={due.today} add={screenOn(clock.today)} />
			<TaskList tasks={due.today} showProject="assigned" timeOnly label="Today tasks" />
		</section>
	{/if}
	{#each due.days as group (group.date)}
		{@const heading = dayHeading(group.date, clock.today)}
		<section {@attach leaving} class="mb-6" aria-label={heading} animate:flip={motion({ duration: 240, easing: cubicOut })} transition:fade={motion({ duration: 160 })}>
			{#if headed}
				<SectionHeading {heading} tasks={group.tasks} add={screenOn(group.date)} />
			{/if}
			<TaskList tasks={group.tasks} showProject="assigned" label={`Tasks on ${group.date}`} />
			{#if !headed}
				<AddTaskButton to={screenOn(group.date)} group={heading} />
			{/if}
		</section>
	{/each}
</View>
