<script lang="ts">
	import ArrowDown from 'phosphor-svelte/lib/ArrowDown';
	import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, mobile } from '#lib/ui.svelte.ts';
	import { noDateTasks } from 'shared/views.ts';

	const SORT_KEY = 'procrastimate.noDateOldestFirst';
	let newestFirst = $state(localStorage.getItem(SORT_KEY) === null);
	const view = $derived(noDateTasks(store.tasks, clock.today, newestFirst));

	function flip() {
		newestFirst = !newestFirst;
		if (newestFirst) localStorage.removeItem(SORT_KEY);
		else localStorage.setItem(SORT_KEY, '1');
	}
</script>

<svelte:head><title>No date · ProcrastiMate</title></svelte:head>

<View
	title="No date"
	empty={view.loose.length + view.places.length === 0}
	emptyTitle="Inbox zero"
	emptyHint={mobile.current ? 'Tap + to capture a task.' : 'Press Q to capture a task.'}
	quickAdd={{ projectId: null, labelId: null, today: false }}
>
	{#snippet actions()}
		<button type="button" class="btn btn-quiet shrink-0" aria-label={newestFirst ? 'Sorted newest first' : 'Sorted oldest first'} onclick={flip}>
			{#if newestFirst}<ArrowDown size={14} weight="bold" />Newest{:else}<ArrowUp size={14} weight="bold" />Oldest{/if}
		</button>
	{/snippet}
	<TaskList tasks={view.loose} label="Tasks without a date" showAdded />
	{#each view.places as place (place.key)}
		<section class="mt-6" aria-label={place.name}>
			<h2 class="mb-1 border-b border-ink/[0.07] px-2 pb-1.5 text-[13px] font-semibold">{place.name}</h2>
			<TaskList tasks={place.tasks} label={`Tasks at ${place.name}`} showAdded />
		</section>
	{/each}
</View>
