<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import ListMenu from '#lib/components/ListMenu.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { listFilters } from '#lib/list-filters.svelte.ts';
	import { session } from '#lib/session.svelte.ts';
	import { formatRadius, placeGroups, savedPlaceAt } from 'shared/triggers.ts';
	import { placeTasks } from 'shared/views.ts';
	import { filterKey, filterTasks } from 'shared/list-filters.ts';
	import { listHeader } from 'shared/list-header.ts';

	const key = $derived(page.params.key ?? '');
	const place = $derived(placeGroups(store.own.tasks, []).find((g) => g.key === key));
	const all = $derived(placeTasks(store.own.tasks, key));
	const list = $derived(filterKey({ kind: 'place', key }));
	const tasks = $derived(filterTasks(all, listFilters.get(list), session.userId ?? ''));
	const title = $derived(place?.name ?? 'Place');
	const saved = $derived(savedPlaceAt(store.own.labels, key));
	/** The earliest task names the place, so its spot and radius are what gets saved. */
	const location = $derived(all.toSorted((a, b) => a.createdAt - b.createdAt)[0]?.location ?? null);

	let name = $state('');
	let taken = $state(false);

	// A saved place lives on its label's screen, so a link from before it was saved lands there.
	$effect(() => {
		if (saved) void goto(`/labels/${saved.id}`, { replace: true });
	});

	function save() {
		const trimmed = name.trim();
		if (!trimmed || !location) return;
		const { name: _, trigger: __, ...spot } = location;
		taken = store.savePlace(trimmed, spot) === null;
	}
</script>

<svelte:head><title>{title} · ProcrastiMate</title></svelte:head>

<View name={title} open={tasks.length} empty={all.length === 0} emptyTitle="Nothing left here" emptyHint="Add a place to a task on iPhone." filter={{ list, tasks: all }}>
	{#snippet actions()}
		<ListMenu header={listHeader({ kind: 'place', saveable: !!location })} label="Place actions" markdown={() => ({ title, sections: [{ heading: null, tasks }] })}>
			{#snippet savePlace()}
				{#if location}
					<form class="w-64 space-y-2 p-1.5" {@attach () => untrack(() => {
						name = place?.name ?? '';
						taken = false;
					})} onsubmit={(e) => {
						e.preventDefault();
						save();
					}}>
						<p class="text-[13px] text-muted">Name this place to pick it as <strong>@name</strong>, like a label. It watches {formatRadius(location.radius)} around it.</p>
						<!-- svelte-ignore a11y_autofocus -->
						<input class="field w-full" aria-label="Place name" placeholder="Home" bind:value={name} autofocus oninput={() => (taken = false)} />
						{#if taken}<p class="text-[13px] text-[var(--tone-overdue)]">A label is already called that.</p>{/if}
						<div class="flex justify-end">
							<button type="submit" class="btn btn-primary" disabled={!name.trim()}>Save place</button>
						</div>
					</form>
				{/if}
			{/snippet}
		</ListMenu>
	{/snippet}
	<TaskList {tasks} showProject label={`Tasks at ${place?.name ?? 'this place'}`} />
</View>
