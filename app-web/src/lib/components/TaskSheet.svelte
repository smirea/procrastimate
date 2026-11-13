<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import type { Task } from 'shared/task.ts';
	import Sheet from './Sheet.svelte';
	import TaskDetails from './TaskDetails.svelte';
	import type { Arrival } from '../sheets.svelte.ts';

	let { task, arrival }: { task: Task; arrival: Arrival } = $props();
</script>

<Sheet {@attach feedback()} label="Task details" desktop="slide" class="flex-col md:top-3 md:right-3 md:bottom-3 md:w-[min(440px,calc(100vw-1.5rem))] md:rounded-panel">
	{#key task.id}
		<TaskDetails {task} {arrival} />
	{/key}
</Sheet>
