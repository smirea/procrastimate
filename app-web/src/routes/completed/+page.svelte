<script lang="ts">
	import View from '#lib/components/View.svelte';
	import CompletedList from '#lib/components/CompletedList.svelte';
	import CompletedRangePicker from '#lib/components/CompletedRangePicker.svelte';
	import SectionHeading from '#lib/components/SectionHeading.svelte';
	import ListMenu from '#lib/components/ListMenu.svelte';
	import { completed } from '#lib/completed.svelte.ts';
	import { store } from '#lib/store.svelte.ts';
	import { clock } from '#lib/ui.svelte.ts';
	import { completedHeading } from 'shared/format.ts';
	import { completedDays } from 'shared/views.ts';
	import { listHeader } from 'shared/list-header.ts';

	const range = $derived(completed.range(clock.today));
	const days = $derived(completedDays(store.own.tasks, range));
</script>

<svelte:head><title>Completed · ProcrastiMate</title></svelte:head>

<View
	name="Completed"
	empty={days.length === 0}
	emptyTitle="Nothing completed"
	emptyHint={range.from === null && range.to === null ? 'Tasks you complete show up here.' : 'Pick a longer range to see more.'}
	canAdd={false}
>
	{#snippet actions()}
		<CompletedRangePicker />
		<ListMenu
			header={listHeader({ kind: 'completed' })}
			label="Completed actions"
			markdown={() => ({
				title: 'Completed',
				sections: days.map((day) => ({ heading: completedHeading(day.date, clock.today), tasks: day.tasks })),
			})}
		/>
	{/snippet}
	{#each days as day, i (day.date)}
		{@const heading = completedHeading(day.date, clock.today)}
		<section class={i > 0 ? 'mt-6' : ''} aria-label={heading}>
			<SectionHeading {heading} tasks={day.tasks} counted={false} />
			<CompletedList tasks={day.tasks} showProject label={`Completed ${heading}`} />
		</section>
	{/each}
</View>
