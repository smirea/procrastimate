<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Task } from 'shared/task.ts';
	import CompletedRow from './CompletedRow.svelte';
	import { motion } from '../ui.svelte.ts';

	let { tasks, showProject = false, label }: { tasks: Task[]; showProject?: boolean; label: string } = $props();
</script>

<ul class="divide-y divide-ink/[0.06]" aria-label={label}>
	{#each tasks as task (task.id)}
		<li
			animate:flip={motion({ duration: 240, easing: cubicOut })}
			in:fly={motion({ y: -8, duration: 220, easing: cubicOut })}
			out:slide={motion({ duration: 200, easing: cubicOut })}
		>
			<CompletedRow {task} {showProject} />
		</li>
	{/each}
</ul>
