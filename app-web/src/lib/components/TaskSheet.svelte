<script lang="ts">
	import type { Task } from 'shared/task.ts';
	import Sheet from './Sheet.svelte';
	import TaskDetails from './TaskDetails.svelte';
	import type { Arrival } from '../ui.svelte.ts';

	let { task, arrival }: { task: Task; arrival: Arrival } = $props();
</script>

<Sheet label="Task details" desktop="slide" class="flex-col md:top-3 md:right-3 md:bottom-3 md:w-[min(440px,calc(100vw-1.5rem))] md:rounded-panel">
	{#key task.id}
		<TaskDetails {task} {arrival} />
	{/key}
</Sheet>
