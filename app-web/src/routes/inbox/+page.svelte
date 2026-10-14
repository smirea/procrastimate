<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, motion } from '#lib/ui.svelte.ts';
	import { todayTasks, upcomingGroups } from 'shared/views.ts';
	import { dayHeading } from 'shared/format.ts';

	const due = $derived(todayTasks(store.tasks, clock.today));
	const days = $derived(upcomingGroups(store.tasks, clock.today));
</script>

<svelte:head><title>Inbox · Procrastimate</title></svelte:head>

<View
	title="Inbox"
	empty={due.overdue.length + due.today.length + days.length === 0}
	emptyTitle="Nothing scheduled"
	emptyHint="Tasks with a date show up here by day."
	quickAdd={{ projectId: null, labelId: null, today: false }}
>
	{#if due.overdue.length}
		<section class="mb-6" aria-label="Overdue">
			<h2 class="section-heading text-[var(--tone-overdue)]">Overdue</h2>
			<TaskList tasks={due.overdue} showProject="assigned" label="Overdue tasks" />
		</section>
	{/if}
	{#if due.today.length}
		<section class="mb-6" aria-label="Today">
			<h2 class="section-heading">Today</h2>
			<TaskList tasks={due.today} showProject="assigned" timeOnly label="Today tasks" />
		</section>
	{/if}
	{#each days as group (group.date)}
		<section class="mb-6" aria-label={dayHeading(group.date, clock.today)} animate:flip={motion({ duration: 240, easing: cubicOut })} transition:fade={motion({ duration: 160 })}>
			<h2 class="section-heading">{dayHeading(group.date, clock.today)}</h2>
			<TaskList tasks={group.tasks} showProject="assigned" label={`Tasks on ${group.date}`} />
		</section>
	{/each}
</View>

<style>
	.section-heading {
		margin-bottom: 0.25rem;
		padding: 0 0.5rem 0.375rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 7%, transparent);
		font-size: 0.8125rem;
		font-weight: 600;
	}
</style>
