<script lang="ts">
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { inboxTasks } from '#lib/views.ts';
	import { mobile } from '#lib/ui.svelte.ts';

	const tasks = $derived(inboxTasks(store.tasks));
</script>

<svelte:head><title>Inbox · Procrastimate</title></svelte:head>

<View
	title="Inbox"
	empty={tasks.length === 0}
	emptyTitle="Inbox zero"
	emptyHint={mobile.current ? 'Tap + to capture a task.' : 'Press Q to capture a task.'}
	quickAdd={{ projectId: null, today: false }}
>
	<TaskList {tasks} label="Inbox tasks" />
</View>
