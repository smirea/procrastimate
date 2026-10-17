<script lang="ts">
	import { page } from '$app/state';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock } from '#lib/ui.svelte.ts';
	import { eventGroups } from 'shared/triggers.ts';
	import { eventTasks } from 'shared/views.ts';

	const id = $derived(page.params.id ?? '');
	const event = $derived(eventGroups(store.own.tasks, clock.today).find((g) => g.id === id));
	const tasks = $derived(eventTasks(store.own.tasks, id, clock.today));
</script>

<svelte:head><title>{event?.title ?? 'Event'} · ProcrastiMate</title></svelte:head>

<View title={event?.title ?? 'Event'} open={tasks.length} empty={tasks.length === 0} emptyTitle="Nothing left for this event" emptyHint="Link a task to a calendar event on iPhone." markdown={() => ({ title: event?.title ?? 'Event', sections: [{ heading: null, tasks }] })}>
	<TaskList {tasks} showProject label={`Tasks for ${event?.title ?? 'this event'}`} />
</View>
