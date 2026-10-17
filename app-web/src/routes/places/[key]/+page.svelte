<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import BookmarkSimple from 'phosphor-svelte/lib/BookmarkSimple';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import Popover from '#lib/components/Popover.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { formatRadius, placeGroups, savedPlaceAt } from 'shared/triggers.ts';
	import { placeTasks } from 'shared/views.ts';

	const key = $derived(page.params.key ?? '');
	const place = $derived(placeGroups(store.own.tasks, []).find((g) => g.key === key));
	const tasks = $derived(placeTasks(store.own.tasks, key));
	const saved = $derived(savedPlaceAt(store.own.labels, key));
	/** The earliest task names the place, so its spot and radius are what gets saved. */
	const location = $derived(tasks.toSorted((a, b) => a.createdAt - b.createdAt)[0]?.location ?? null);

	let name = $state('');
	let taken = $state(false);

	// A saved place lives on its label's screen, so a link from before it was saved lands there.
	$effect(() => {
		if (saved) void goto(`/labels/${saved.id}`, { replaceState: true });
	});

	function save() {
		const trimmed = name.trim();
		if (!trimmed || !location) return;
		const { name: _, trigger: __, ...spot } = location;
		taken = store.savePlace(trimmed, spot) === null;
	}
</script>

<svelte:head><title>{place?.name ?? 'Place'} · ProcrastiMate</title></svelte:head>

<View title={place?.name ?? 'Place'} open={tasks.length} empty={tasks.length === 0} emptyTitle="Nothing left here" emptyHint="Add a place to a task on iPhone." markdown={() => ({ title: place?.name ?? 'Place', sections: [{ heading: null, tasks }] })}>
	{#snippet actions()}
		{#if location}
			<Popover label="Save place" align="end">
				{#snippet trigger({ toggle })}
					<button type="button" class="btn btn-quiet touch:min-h-11" onclick={() => {
						name = place?.name ?? '';
						taken = false;
						toggle();
					}}><BookmarkSimple size={17} />Save</button>
				{/snippet}
				{#snippet children()}
					<form class="w-64 space-y-2 p-1.5" onsubmit={(e) => {
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
				{/snippet}
			</Popover>
		{/if}
	{/snippet}
	<TaskList {tasks} showProject label={`Tasks at ${place?.name ?? 'this place'}`} />
</View>
