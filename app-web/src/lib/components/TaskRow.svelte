<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Tray from 'phosphor-svelte/lib/Tray';
	import type { Task } from 'shared/task.ts';
	import { store } from '../store.svelte.ts';
	import { clock, sheets, toasts } from '../ui.svelte.ts';
	import { PRIORITIES, dueTone, formatDue, formatTime } from '../format.ts';

	let { task, showProject = false, timeOnly = false }: { task: Task; showProject?: boolean; timeOnly?: boolean } = $props();

	let checking = $state(false);
	const project = $derived(store.project(task.projectId));
	const tone = $derived(PRIORITIES[task.priority].tone);

	function complete() {
		if (checking) return;
		checking = true;
		setTimeout(() => {
			store.setCompleted(task.id, true);
			toasts.show(`Completed “${task.title}”`, { label: 'Undo', run: () => store.setCompleted(task.id, false) });
		}, 260);
	}
</script>

<div class="group flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/60" data-task={task.title}>
	<button
		type="button"
		role="checkbox"
		aria-checked={checking}
		aria-label={`Complete ${task.title}`}
		class="checkbox mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]"
		class:checked={checking}
		style={`--tone: ${tone}`}
		onclick={complete}
	>
		<Check size={10} weight="bold" class="check-icon" />
	</button>
	<button type="button" class="min-w-0 flex-1 text-left" onclick={() => sheets.openTask(task.id)}>
		<div class="truncate text-[14px] leading-5 text-ink transition-colors" class:done={checking}>{task.title}</div>
		{#if task.notes}
			<div class="truncate text-[12px] leading-4 text-muted">{task.notes}</div>
		{/if}
		{#if task.due || task.reminders.length || (showProject && project)}
			<div class="mt-0.5 flex items-center gap-3 text-[12px] leading-4 text-muted">
				{#if task.due && !(timeOnly && !task.due.time)}
					<span class="flex items-center gap-1" style={`color: var(--tone-${dueTone(task.due, clock.today)})`}>
						<CalendarBlank size={12} />
						{timeOnly && task.due.time ? formatTime(task.due.time) : formatDue(task.due, clock.today)}
					</span>
				{/if}
				{#if task.reminders.length}
					<span class="flex items-center gap-1" aria-label={`${task.reminders.length} reminders`}>
						<Bell size={12} />{task.reminders.length}
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

	.checkbox:hover {
		background: color-mix(in srgb, var(--tone) 18%, transparent);
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

	.checkbox:hover :global(.check-icon) {
		opacity: 0.6;
		transform: scale(1);
		color: var(--tone);
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
