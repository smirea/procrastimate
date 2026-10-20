<script lang="ts">
	import { page } from '$app/state';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import ListMenu from '#lib/components/ListMenu.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { listFilters } from '#lib/list-filters.svelte.ts';
	import { session } from '#lib/session.svelte.ts';
	import { clock } from '#lib/ui.svelte.ts';
	import { eventGroups } from 'shared/triggers.ts';
	import { eventTasks } from 'shared/views.ts';
	import { filterKey, filterTasks } from 'shared/list-filters.ts';
	import { listHeader } from 'shared/list-header.ts';

	const id = $derived(page.params.id ?? '');
	const event = $derived(eventGroups(store.own.tasks, clock.today).find((g) => g.id === id));
	const all = $derived(eventTasks(store.own.tasks, id, clock.today));
	const list = $derived(filterKey({ kind: 'event', id }));
	const tasks = $derived(filterTasks(all, listFilters.get(list), session.userId ?? ''));
	const title = $derived(event?.title ?? 'Event');
</script>

<svelte:head><title>{title} · ProcrastiMate</title></svelte:head>

<View name={title} open={tasks.length} empty={all.length === 0} emptyTitle="Nothing left for this event" emptyHint="Link a task to a calendar event on iPhone." filter={{ list, tasks: all }}>
	{#snippet actions()}
		<ListMenu header={listHeader({ kind: 'event' })} label="Event actions" markdown={() => ({ title, sections: [{ heading: null, tasks }] })} />
	{/snippet}
	<TaskList {tasks} showProject label={`Tasks for ${event?.title ?? 'this event'}`} />
</View>
