<script lang="ts">
	import { motion } from '../ui.svelte.ts';
	import { flip } from 'svelte/animate';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Task } from 'shared/task.ts';
	import TaskRow from './TaskRow.svelte';

	/** `assigned` names only a real project, for Inbox, where `Inbox` on every row would say nothing. */
	let {
		tasks,
		showProject = false,
		timeOnly = false,
		showAdded = false,
		label,
	}: { tasks: Task[]; showProject?: boolean | 'assigned'; timeOnly?: boolean; showAdded?: boolean; label: string } = $props();
</script>

<ul class="divide-y divide-ink/[0.06]" aria-label={label}>
	{#each tasks as task (task.id)}
		<li
			animate:flip={motion({ duration: 240, easing: cubicOut })}
			in:fly={motion({ y: -8, duration: 220, easing: cubicOut })}
			out:slide={motion({ duration: 200, easing: cubicOut })}
		>
			<TaskRow {task} showProject={showProject === 'assigned' ? task.projectId !== null : showProject} {timeOnly} {showAdded} />
		</li>
	{/each}
</ul>
