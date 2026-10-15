<script lang="ts">
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, mobile } from '#lib/ui.svelte.ts';
	import { noDateTasks } from 'shared/views.ts';

	const view = $derived(noDateTasks(store.own.tasks, clock.today));
</script>

<svelte:head><title>No date · ProcrastiMate</title></svelte:head>

<View
	title="No date"
	empty={view.loose.length + view.places.length === 0}
	emptyTitle="Inbox zero"
	emptyHint={mobile.current ? 'Tap + to capture a task.' : 'Press Q to capture a task.'}
	quickAdd={{ projectId: null, labelId: null, today: false }}
>
	<TaskList tasks={view.loose} label="Tasks without a date" />
	{#each view.places as place (place.key)}
		<section class="mt-6" aria-label={place.name}>
			<h2 class="mb-1 border-b border-ink/[0.07] px-2 pb-1.5 text-[13px] font-semibold">{place.name}</h2>
			<TaskList tasks={place.tasks} label={`Tasks at ${place.name}`} />
		</section>
	{/each}
</View>
