<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import SectionHeading from '#lib/components/SectionHeading.svelte';
	import AddTaskButton from '#lib/components/AddTaskButton.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, leaving, motion } from '#lib/ui.svelte.ts';
	import { todayTasks, upcomingGroups } from 'shared/views.ts';
	import { dayHeading } from 'shared/format.ts';

	const due = $derived(todayTasks(store.own.tasks, clock.today));
	const days = $derived(upcomingGroups(store.own.tasks, clock.today));
	const sections = $derived([
		{ heading: 'Overdue', tasks: due.overdue },
		{ heading: 'Today', tasks: due.today },
		...days.map(group => ({ heading: dayHeading(group.date, clock.today), tasks: group.tasks })),
	]);
</script>

<svelte:head><title>Inbox · ProcrastiMate</title></svelte:head>

<View
	name="Inbox"
	open={sections.reduce((n, s) => n + s.tasks.length, 0)}
	empty={due.overdue.length + due.today.length + days.length === 0}
	emptyTitle="Nothing scheduled"
	emptyHint="Tasks with a date show up here by day."
	canAdd={due.today.length + days.length === 0}
	markdown={() => ({ title: 'Inbox', sections })}
>
	{#if due.overdue.length}
		<section class="mb-6" aria-label="Overdue">
			<SectionHeading heading="Overdue" tasks={due.overdue} class="text-[var(--tone-overdue)]" />
			<TaskList tasks={due.overdue} showProject="assigned" label="Overdue tasks" />
		</section>
	{/if}
	{#if due.today.length}
		<section class="mb-6" aria-label="Today">
			<SectionHeading heading="Today" tasks={due.today} />
			<TaskList tasks={due.today} showProject="assigned" timeOnly label="Today tasks" />
			<AddTaskButton to={{ kind: 'inbox', date: clock.today }} group="Today" />
		</section>
	{/if}
	{#each days as group (group.date)}
		<section {@attach leaving} class="mb-6" aria-label={dayHeading(group.date, clock.today)} animate:flip={motion({ duration: 240, easing: cubicOut })} transition:fade={motion({ duration: 160 })}>
			<SectionHeading heading={dayHeading(group.date, clock.today)} tasks={group.tasks} />
			<TaskList tasks={group.tasks} showProject="assigned" label={`Tasks on ${group.date}`} />
			<AddTaskButton to={{ kind: 'inbox', date: group.date }} group={dayHeading(group.date, clock.today)} />
		</section>
	{/each}
</View>
