<script lang="ts">
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Task } from 'shared/task.ts';
	import { completedTasks } from 'shared/views.ts';
	import CompletedList from './CompletedList.svelte';
	import { completed } from '../completed.svelte.ts';
	import { motion } from '../ui.svelte.ts';

	/** `tasks` is the view's own slice, open and done, so a subtask finished with its parent stays under it. */
	let { tasks, showProject = false }: { tasks: Task[]; showProject?: boolean } = $props();

	const list = $derived(completed.shown ? completedTasks(tasks, { from: null, to: null }) : []);
</script>

{#if completed.shown}
	<section class="mt-6" aria-label="Completed" transition:slide={motion({ duration: 200, easing: cubicOut })}>
		<div class="mb-1 flex items-center justify-between border-b border-ink/[0.07] pr-1 pb-1.5 pl-2">
			<h2 class="text-[13px] font-semibold text-muted">Completed</h2>
			{#if list.length}<span class="text-[12px] text-faint">{list.length}</span>{/if}
		</div>
		{#if list.length}
			<CompletedList tasks={list} {showProject} label="Completed tasks" />
		{:else}
			<p class="px-2 py-3 text-[13px] text-faint">Nothing completed yet.</p>
		{/if}
	</section>
{/if}
