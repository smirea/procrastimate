<script lang="ts">
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, mobile } from '#lib/ui.svelte.ts';
	import { todayTasks } from 'shared/views.ts';
	import { fromDateKey } from 'shared/task.ts';

	const tasks = $derived(todayTasks(store.tasks, clock.today));
	const subtitle = $derived(fromDateKey(clock.today).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
</script>

<svelte:head><title>Today · Procrastimate</title></svelte:head>

<View
	title="Today"
	{subtitle}
	empty={tasks.overdue.length + tasks.today.length === 0}
	emptyTitle="All clear for today"
	emptyHint={mobile.current ? 'Enjoy it, or tap + to add something.' : 'Enjoy it, or add something with Q.'}
	quickAdd={{ projectId: null, labelId: null, today: true }}
>
	{#if tasks.overdue.length}
		<h2 class="section-heading text-[var(--tone-overdue)]">Overdue</h2>
		<TaskList tasks={tasks.overdue} showProject label="Overdue tasks" />
		<h2 class="section-heading mt-6">Today</h2>
	{/if}
	<TaskList tasks={tasks.today} showProject timeOnly label="Today tasks" />
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
