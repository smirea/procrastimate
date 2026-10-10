<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Tray from 'phosphor-svelte/lib/Tray';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Tag from 'phosphor-svelte/lib/Tag';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Task } from 'shared/task.ts';
	import { store } from '../store.svelte.ts';
	import { clock, sheets } from '../ui.svelte.ts';
	import { PRIORITIES, dueTone, formatDue, formatTime, repeatLabel } from '../format.ts';
	import { completeTask } from '../completion.ts';

	let { task, showProject = false, timeOnly = false }: { task: Task; showProject?: boolean; timeOnly?: boolean } = $props();

	let checking = $state(false);
	const project = $derived(store.project(task.projectId));
	const labels = $derived(store.labelsOf(task));
	const tone = $derived(PRIORITIES[task.priority].tone);

	function complete() {
		if (checking) return;
		checking = true;
		setTimeout(() => {
			completeTask(task);
			checking = false;
		}, 260);
	}
</script>

<div class="group flex items-start gap-3 rounded-xl px-2 transition-colors hover:bg-surface/60" data-task={task.title}>
	<button
		type="button"
		role="checkbox"
		aria-checked={checking}
		aria-label={`Complete ${task.title}`}
		class="checkbox hit-area relative mt-3 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] touch:mt-3.5 touch:size-5"
		class:checked={checking}
		style={`--tone: ${tone}`}
		onclick={complete}
	>
		<Check size={10} weight="bold" class="check-icon" />
	</button>
	<button type="button" class="min-w-0 flex-1 py-2.5 text-left touch:min-h-11 touch:py-3" onclick={() => sheets.openTask(task.id)}>
		<div class="truncate text-[14px] leading-5 text-ink transition-colors" class:done={checking}>{task.title}</div>
		{#if task.notes}
			<div class="truncate text-[12px] leading-4 text-muted">{task.notes}</div>
		{/if}
		{#if task.due || task.recurrence || task.reminders.length || labels.length || (showProject && project)}
			<div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-muted">
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
				{#if task.reminders.length}
					<span class="flex items-center gap-1" aria-label={`${task.reminders.length} reminders`}>
						<Bell size={12} />{task.reminders.length}
					</span>
				{/if}
				{#if labels.length}
					<span class="flex min-w-0 flex-wrap items-center gap-1">
						{#each labels as label (label.id)}
							<span class="label-chip" data-label={label.name} transition:scale={{ start: 0.6, duration: 180, easing: cubicOut }}>
								<Tag size={10} weight="fill" class="shrink-0 text-[var(--tone-label)]" />
								<span class="truncate">{label.name}</span>
							</span>
						{/each}
					</span>
				{/if}
				{#if showProject}
					<span class="ml-auto flex items-center gap-1">
						{#if project}<Hash size={12} />{project.name}{:else}<Tray size={12} />Inbox{/if}
					</span>
				{/if}
			</div>
		{/if}
	</button>
</div>

<style>
	.checkbox {
		border-color: var(--tone);
		background: color-mix(in srgb, var(--tone) 8%, transparent);
		color: white;
		transition:
			background 180ms var(--ease-spring),
			transform 180ms var(--ease-spring);
	}

	@media (hover: hover) {
		.checkbox:hover {
			background: color-mix(in srgb, var(--tone) 18%, transparent);
		}

		.checkbox:hover :global(.check-icon) {
			opacity: 0.6;
			transform: scale(1);
			color: var(--tone);
		}
	}

	.checkbox:active {
		transform: scale(0.88);
	}

	.checkbox :global(.check-icon) {
		opacity: 0;
		transform: scale(0.4);
		transition:
			opacity 160ms var(--ease-spring),
			transform 220ms var(--ease-spring);
	}

	.checkbox.checked {
		background: var(--tone);
		animation: pop 260ms var(--ease-spring);
	}

	.checkbox.checked :global(.check-icon) {
		opacity: 1;
		transform: scale(1);
		color: white;
	}

	.done {
		color: var(--color-faint);
		text-decoration: line-through;
	}

	@keyframes pop {
		50% {
			transform: scale(1.18);
		}
	}
</style>
