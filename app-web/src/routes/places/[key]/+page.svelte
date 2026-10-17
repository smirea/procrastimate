<script lang="ts">
	import { page } from '$app/state';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { placeGroups } from 'shared/triggers.ts';
	import { placeTasks } from 'shared/views.ts';

	const key = $derived(page.params.key ?? '');
	const place = $derived(placeGroups(store.own.tasks).find((g) => g.key === key));
	const tasks = $derived(placeTasks(store.own.tasks, key));
</script>

<svelte:head><title>{place?.name ?? 'Place'} · ProcrastiMate</title></svelte:head>

<View title={place?.name ?? 'Place'} open={tasks.length} empty={tasks.length === 0} emptyTitle="Nothing left here" emptyHint="Add a place to a task on iPhone." markdown={() => ({ title: place?.name ?? 'Place', sections: [{ heading: null, tasks }] })}>
	<TaskList {tasks} showProject label={`Tasks at ${place?.name ?? 'this place'}`} />
</View>
