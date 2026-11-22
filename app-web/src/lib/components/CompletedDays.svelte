<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Task } from 'shared/task.ts';
	import { completedHeading } from 'shared/format.ts';
	import { byCompletedDay } from 'shared/views.ts';
	import CompletedList from './CompletedList.svelte';
	import { clock } from '../clock.svelte.ts';
	import { motion } from '../motion.ts';

	/** `tasks` are done ones, newest first, shown under the day each was completed. */
	let { tasks, showProject = false, label }: { tasks: Task[]; showProject?: boolean; label: string } = $props();

	const days = $derived(byCompletedDay(tasks));
</script>

{#each days as day (day.date)}
	{@const heading = completedHeading(day.date, clock.today)}
	<div {@attach feedback()} transition:slide={motion({ duration: 200, easing: cubicOut })}>
		<h3 class="px-2 pt-3 text-[12px] font-medium text-faint">{heading}</h3>
		<CompletedList tasks={day.tasks} {showProject} label={`${label}, ${heading}`} />
	</div>
{/each}
