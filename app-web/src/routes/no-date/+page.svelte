<script lang="ts">
	import { FIXED_NAMES } from 'shared/screens.ts';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import AddTaskButton from '#lib/components/AddTaskButton.svelte';
	import ListMenu from '#lib/components/ListMenu.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { listFilters } from '#lib/list-filters.svelte.ts';
	import { session } from '#lib/session.svelte.ts';
	import { clock } from '#lib/clock.svelte.ts';
	import { mobile } from '#lib/motion.ts';
	import { noDateTasks } from 'shared/views.ts';
	import { listHeader } from 'shared/list-header.ts';
	import { DEVICE_KEYS } from '#lib/device.ts';

	const SORT_KEY = DEVICE_KEYS.noDateOldestFirst;
	let newestFirst = $state(localStorage.getItem(SORT_KEY) === null);
	const all = $derived(noDateTasks(store.own.tasks, clock.today, newestFirst));
	const tasks = $derived(listFilters.apply('no-date', all));

	function flip() {
		newestFirst = !newestFirst;
		if (newestFirst) localStorage.removeItem(SORT_KEY);
		else localStorage.setItem(SORT_KEY, '1');
	}
</script>

<svelte:head><title>{FIXED_NAMES['no-date']} · ProcrastiMate</title></svelte:head>

<View
	name={FIXED_NAMES['no-date']}
	open={tasks.length}
	empty={all.length === 0}
	emptyTitle="Inbox zero"
	emptyHint={mobile.current ? 'Tap + to capture a task.' : 'Press Q to capture a task.'}
	canAdd={false}
	filter={{ list: 'no-date', tasks: all }}
>
	{#snippet actions()}
		<ListMenu
			header={listHeader({ kind: 'no-date' })}
			label="No date actions"
			markdown={() => ({ title: 'No date', sections: [{ heading: null, tasks }] })}
			sort={{ newestFirst, flip }}
		/>
	{/snippet}
	<TaskList {tasks} label="Tasks without a date" showAdded />
	<AddTaskButton />
</View>
