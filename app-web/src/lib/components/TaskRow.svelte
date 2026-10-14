<script lang="ts">
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import CalendarStar from 'phosphor-svelte/lib/CalendarStar';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Tray from 'phosphor-svelte/lib/Tray';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Tag from 'phosphor-svelte/lib/Tag';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ArrowElbowDownRight from 'phosphor-svelte/lib/ArrowElbowDownRight';
	import CalendarPlus from 'phosphor-svelte/lib/CalendarPlus';
	import Popover from './Popover.svelte';
	import type { Task } from 'shared/task.ts';
	import Checkbox from './Checkbox.svelte';
	import SubtaskProgress from './SubtaskProgress.svelte';
	import { store } from '../store.svelte.ts';
	import { clock, sheets, motion } from '../ui.svelte.ts';
	import { WEEKDAY_NAMES, dueTone, formatDue, formatTime, postponeOptions, repeatLabel } from 'shared/format.ts';
	import { weekdayOf } from 'shared/task.ts';
	import { eventLabel, formatLocation, scheduledDue } from 'shared/triggers.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { completeTask, postponeTask } from '../completion.ts';

	let { task, showProject = false, timeOnly = false }: { task: Task; showProject?: boolean; timeOnly?: boolean } = $props();

	let checking = $state(false);
	const project = $derived(store.project(task.projectId));
	const labels = $derived(store.labelsOf(task));
	const parent = $derived(task.parentId ? store.task(task.parentId) : undefined);
	const progress = $derived(store.progress(task.id));
	const due = $derived(scheduledDue(task, clock.today));
	const event = $derived(task.event ? eventLabel(task.event, clock.today) : null);

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
		{#if due || task.recurrence || task.reminders.length || task.location || progress || labels.length || parent || (showProject && project)}
			<div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-muted">
				{#if task.event && event && due}
					<span
						class="flex min-w-0 items-center gap-1"
						aria-label={[event.when, `${event.lead}${task.event.series ? ' every' : ''} ${event.title}`].filter(Boolean).join(', ')}
					>
						{#if event.when}<span class="shrink-0" style={`color: var(--tone-${dueTone(due, clock.today)})`}>{event.when}</span>{/if}
						<span class="flex min-w-0 items-center gap-1 text-muted">
							{#if event.when}<span class="shrink-0">(</span>{/if}
							{#if task.event.series}<Repeat size={12} weight="bold" class="shrink-0" />{/if}
							<span class="shrink-0">{event.lead}</span>
							<CalendarStar size={12} class="shrink-0" />
							<span class="truncate">{event.title}</span>
							{#if event.when}<span class="-ml-1 shrink-0">)</span>{/if}
						</span>
					</span>
				{:else if due && !(timeOnly && !due.time)}
					<span class="flex items-center gap-1" style={`color: var(--tone-${dueTone(due, clock.today)})`}>
						<CalendarBlank size={12} />
						{timeOnly && due.time ? formatTime(due.time) : formatDue(due, clock.today)}
					</span>
				{/if}
				{#if task.location}
					<span class="flex min-w-0 items-center gap-1">
						<MapPin size={12} class="shrink-0" /><span class="truncate">{formatLocation(task.location)}</span>
					</span>
				{/if}
				{#if task.recurrence}
					<span class="flex items-center text-[var(--tone-repeat)]" role="img" aria-label={repeatLabel(task.recurrence, due)}>
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
	{#if !task.event}
		<div class="mt-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
			<Popover label="Postpone" align="end">
				{#snippet trigger({ toggle })}
					<button type="button" class="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5" aria-label={`Postpone ${task.title}`} onclick={toggle}>
						<CalendarPlus size={16} />
					</button>
				{/snippet}
				{#snippet children({ close })}
					{#each postponeOptions(due, clock.today) as option (option.date)}
						<button
							type="button"
							class="menu-item flex justify-between gap-6"
							onclick={() => {
								postponeTask(task, option.date);
								close();
							}}
						>
							{option.label}<span class="text-muted">{WEEKDAY_NAMES[weekdayOf(option.date)]}</span>
						</button>
					{/each}
				{/snippet}
			</Popover>
		</div>
	{/if}
</div>

<style>
	.done {
		color: var(--color-faint);
		text-decoration: line-through;
	}
</style>
