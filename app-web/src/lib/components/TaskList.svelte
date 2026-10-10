<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Task } from 'shared/task.ts';
	import TaskRow from './TaskRow.svelte';

	let { tasks, showProject = false, timeOnly = false, label }: { tasks: Task[]; showProject?: boolean; timeOnly?: boolean; label: string } = $props();
</script>

<ul class="divide-y divide-black/[0.05]" aria-label={label}>
	{#each tasks as task (task.id)}
		<li
			animate:flip={{ duration: 240, easing: cubicOut }}
			in:fly={{ y: -8, duration: 220, easing: cubicOut }}
			out:slide={{ duration: 200, easing: cubicOut }}
		>
			<TaskRow {task} {showProject} {timeOnly} />
		</li>
	{/each}
</ul>
