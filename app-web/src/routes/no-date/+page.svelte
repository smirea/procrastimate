<script lang="ts">
	import ArrowDown from 'phosphor-svelte/lib/ArrowDown';
	import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import AddTaskButton from '#lib/components/AddTaskButton.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, mobile } from '#lib/ui.svelte.ts';
	import { noDateTasks } from 'shared/views.ts';
	import { DEVICE_KEYS } from '#lib/device.ts';

	const SORT_KEY = DEVICE_KEYS.noDateOldestFirst;
	let newestFirst = $state(localStorage.getItem(SORT_KEY) === null);
	const tasks = $derived(noDateTasks(store.own.tasks, clock.today, newestFirst));

	function flip() {
		newestFirst = !newestFirst;
		if (newestFirst) localStorage.removeItem(SORT_KEY);
		else localStorage.setItem(SORT_KEY, '1');
	}
</script>

<svelte:head><title>No date · ProcrastiMate</title></svelte:head>

<View
	name="No date"
	open={tasks.length}
	empty={tasks.length === 0}
	emptyTitle="Inbox zero"
	emptyHint={mobile.current ? 'Tap + to capture a task.' : 'Press Q to capture a task.'}
	canAdd={false}
	markdown={() => ({
		title: 'No date',
		sections: [{ heading: null, tasks }],
	})}
>
	{#snippet actions()}
		<button type="button" class="btn btn-quiet shrink-0" aria-label={newestFirst ? 'Sorted newest first' : 'Sorted oldest first'} onclick={flip}>
			{#if newestFirst}<ArrowDown size={14} weight="bold" />Newest{:else}<ArrowUp size={14} weight="bold" />Oldest{/if}
		</button>
	{/snippet}
	<TaskList {tasks} label="Tasks without a date" showAdded />
	<AddTaskButton />
</View>
