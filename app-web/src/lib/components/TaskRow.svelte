<script lang="ts">
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Tray from 'phosphor-svelte/lib/Tray';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Tag from 'phosphor-svelte/lib/Tag';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ArrowElbowDownRight from 'phosphor-svelte/lib/ArrowElbowDownRight';
	import type { Task } from 'shared/task.ts';
	import Checkbox from './Checkbox.svelte';
	import SubtaskProgress from './SubtaskProgress.svelte';
	import { store } from '../store.svelte.ts';
	import { clock, sheets, motion } from '../ui.svelte.ts';
	import { dueTone, formatDue, formatTime, repeatLabel } from 'shared/format.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { completeTask } from '../completion.ts';

	let { task, showProject = false, timeOnly = false }: { task: Task; showProject?: boolean; timeOnly?: boolean } = $props();

	let checking = $state(false);
	const project = $derived(store.project(task.projectId));
	const labels = $derived(store.labelsOf(task));
	const parent = $derived(task.parentId ? store.task(task.parentId) : undefined);
	const progress = $derived(store.progress(task.id));

	function complete() {
		if (checking) return;
		checking = true;
		setTimeout(() => {
			completeTask(task);
			checking = false;
		}, 260);
	}
</script>

<div class="group flex items-start gap-3 rounded-2xl px-2 transition-colors hover:bg-surface/60" data-task={task.title}>
	<Checkbox checked={checking} tone={PRIORITIES[task.priority].tone} label={`Complete ${task.title}`} class="mt-3 touch:mt-3.5" onclick={complete} />
	<button type="button" class="min-w-0 flex-1 py-2.5 text-left touch:min-h-11 touch:py-3" onclick={() => sheets.openTask(task.id)}>
		<div class="truncate text-[14px] leading-5 text-ink transition-colors" class:done={checking}>{task.title}</div>
		{#if task.notes}
			<div class="truncate text-[12px] leading-4 text-muted">{task.notes}</div>
		{/if}
		{#if task.due || task.recurrence || task.reminders.length || progress || labels.length || parent || (showProject && project)}
			<div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-muted">
				{#if task.due && !(timeOnly && !task.due.time)}
					<span class="flex items-center gap-1" style={`color: var(--tone-${dueTone(task.due, clock.today)})`}>
						<CalendarBlank size={12} />
						{timeOnly && task.due.time ? formatTime(task.due.time) : formatDue(task.due, clock.today)}
					</span>
				{/if}
				{#if task.recurrence}
					<span class="flex items-center text-[var(--tone-tomorrow)]" role="img" aria-label={repeatLabel(task.recurrence, task.due)}>
						<Repeat size={12} weight="bold" />
					</span>
				{/if}
				{#if progress}
					<SubtaskProgress {progress} />
				{/if}
				{#if task.reminders.length}
					<span class="flex items-center gap-1" aria-label={`${task.reminders.length} reminders`}>
						<Bell size={12} />{task.reminders.length}
					</span>
				{/if}
				{#if labels.length}
					<span class="flex min-w-0 flex-wrap items-center gap-1">
						{#each labels as label (label.id)}
							<span class="label-chip" data-label={label.name} transition:scale={motion({ start: 0.6, duration: 180, easing: cubicOut })}>
								<Tag size={10} weight="fill" class="shrink-0 text-[var(--tone-label)]" />
								<span class="truncate">{label.name}</span>
							</span>
						{/each}
					</span>
				{/if}
				{#if parent}
					<span class="flex min-w-0 items-center gap-1" aria-label={`Subtask of ${parent.title}`}>
						<ArrowElbowDownRight size={12} class="shrink-0" /><span class="truncate">{parent.title}</span>
					</span>
				{/if}
				{#if showProject}
					<span class="ml-auto flex shrink-0 items-center gap-1">
						{#if project}<Hash size={12} />{project.name}{:else}<Tray size={12} />Inbox{/if}
					</span>
				{/if}
			</div>
		{/if}
	</button>
</div>

<style>
	.done {
		color: var(--color-faint);
		text-decoration: line-through;
	}
</style>
