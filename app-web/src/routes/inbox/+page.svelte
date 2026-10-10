<script lang="ts">
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { inboxTasks } from '#lib/views.ts';

	const tasks = $derived(inboxTasks(store.tasks));
</script>

<svelte:head><title>Inbox · Procrastimate</title></svelte:head>

<View
	title="Inbox"
	empty={tasks.length === 0}
	emptyTitle="Inbox zero"
	emptyHint="Press Q to capture a task."
	quickAdd={{ projectId: null, today: false }}
>
	<TaskList {tasks} label="Inbox tasks" />
</View>
