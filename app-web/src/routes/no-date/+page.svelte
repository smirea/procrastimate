<script lang="ts">
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, mobile } from '#lib/ui.svelte.ts';
	import { inboxTasks } from 'shared/views.ts';

	const tasks = $derived(inboxTasks(store.tasks, clock.today));
</script>

<svelte:head><title>No date · Procrastimate</title></svelte:head>

<View
	title="No date"
	empty={tasks.length === 0}
	emptyTitle="Inbox zero"
	emptyHint={mobile.current ? 'Tap + to capture a task.' : 'Press Q to capture a task.'}
	quickAdd={{ projectId: null, labelId: null, today: false }}
>
	<TaskList {tasks} label="Tasks without a date" />
</View>
