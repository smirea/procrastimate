<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Trash from 'phosphor-svelte/lib/Trash';
	import Check from 'phosphor-svelte/lib/Check';
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CalendarStar from 'phosphor-svelte/lib/CalendarStar';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import Waveform from 'phosphor-svelte/lib/Waveform';
	import { formatDue } from 'shared/format.ts';
	import { formatEvent, formatLocation, scheduledDue } from 'shared/triggers.ts';
	import { parseMemoSource } from 'shared/memo-tasks.ts';
	import { parseQuickAdd } from 'shared/quick-add.ts';
	import type { Task } from 'shared/task.ts';
	import SmartInput from './SmartInput.svelte';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import RecurrencePicker from './RecurrencePicker.svelte';
	import ProjectPicker from './ProjectPicker.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import Subtasks from './Subtasks.svelte';
	import { store, type TaskPatch } from '../store.svelte.ts';
	import { clock, sheets, toasts, motion, type Arrival } from '../ui.svelte.ts';
	import { completeTask } from '../completion.ts';

	let { task, arrival }: { task: Task; arrival: Arrival } = $props();

	const parent = $derived(task.parentId ? store.task(task.parentId) : undefined);

	let title = $state(untrack(() => task.title));
	const parsed = $derived(
		parseQuickAdd(title, { now: new Date(clock.now), projects: parent ? [] : store.projects, labels: store.labels, due: task.due }),
	);
	// The chips below show what the title will apply, so the edit can be checked before Enter or blur commits it.
	const draft = $derived(
		title !== task.title && parsed.title
			? {
					title: parsed.title,
					// An event stands in for the date and repeat, so a typed one is ignored on an event task.
					due: task.event ? null : (parsed.due ?? task.due),
					recurrence: task.event ? null : (parsed.recurrence ?? task.recurrence),
					priority: parsed.priority ?? task.priority,
					projectId: parsed.projectId ?? task.projectId,
					labelIds: [...new Set([...task.labelIds, ...parsed.labelIds])],
					reminders: [...task.reminders, ...parsed.reminders],
				}
			: task,
	);

	const update = (patch: TaskPatch) => store.updateTask(task.id, patch);
	const eventDue = $derived(task.event ? scheduledDue(task, clock.today) : null);

	function commitTitle() {
		if (title === task.title) return;
		if (!parsed.title) {
			title = task.title;
			return;
		}
		const { title: next, due, recurrence, priority, projectId, labelIds, reminders } = draft;
		update({ title: next, due, recurrence, priority, projectId, labelIds, reminders });
		title = next;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitTitle();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			title = task.title;
			sheets.close();
		}
	}

	/** A subtask's details return to its parent once the subtask is done or gone. */
	function leave(parentId: string | null) {
		if (parentId) sheets.openTask(parentId, 'back');
		else sheets.close();
	}

	function remove() {
		const { parentId } = task;
		const removed = store.deleteTask(task.id);
		leave(parentId);
		toasts.show(`Deleted “${removed[0]!.title}”`, { label: 'Undo', run: () => store.undeleteTasks(removed) });
	}

	function complete() {
		const { parentId } = task;
		completeTask(task);
		leave(parentId);
	}

	const slideFrom = { forward: 28, back: -28, none: 0 } satisfies Record<Arrival, number>;
</script>

<div class="relative flex min-h-0 flex-1 flex-col" in:fly={motion({ x: slideFrom[arrival], duration: arrival === 'none' ? 0 : 220, easing: cubicOut })}>
	<header class="flex items-center justify-between gap-2 px-4 pt-3">
		{#if parent}
			<button
				type="button"
				class="chip min-w-0"
				aria-label={`Back to ${parent.title}`}
				onclick={() => sheets.openTask(parent.id, 'back')}
			>
				<CaretLeft size={14} class="shrink-0" /><span class="truncate">{parent.title}</span>
			</button>
		{:else}
			<ProjectPicker projectId={draft.projectId} onchange={(projectId) => update({ projectId })} />
		{/if}
		<button type="button" class="icon-btn shrink-0" aria-label="Close" onclick={() => sheets.close()}>
			<X size={16} />
		</button>
	</header>
	<div class="px-4 pt-4">
		<SmartInput bind:value={title} tokens={parsed.tokens} label="Title" enterkeyhint="done" suggestProjects={!parent} class="text-[19px] font-semibold" {onkeydown} onblur={commitTitle} />
	</div>
	<!-- Outside the scroll area, which would clip the pickers' popovers. -->
	<div class="flex flex-wrap gap-1.5 px-4 pt-3">
		{#if task.event}
			<span class="chip" data-active="true" title="Set on iPhone">
				<CalendarStar size={15} weight="fill" />
				{formatEvent(task.event)}{eventDue ? ` · ${formatDue(eventDue, clock.today)}` : ''}
			</span>
		{:else}
			<DuePicker
				due={draft.due}
				onchange={(due) => update({ due, recurrence: due ? task.recurrence : null })}
			/>
			<RecurrencePicker
				recurrence={draft.recurrence}
				due={draft.due}
				onchange={(recurrence, due) => update({ recurrence, due })}
			/>
		{/if}
		<PriorityPicker priority={draft.priority} onchange={(priority) => update({ priority })} />
		<ReminderPicker
			due={eventDue ?? draft.due}
			reminders={draft.reminders}
			onchange={(reminders) => update({ reminders })}
		/>
		{#if task.location}
			<span class="chip" data-active="true" title={`${task.location.address ?? task.location.name} · Set on iPhone`}>
				<MapPin size={15} weight="fill" />
				{formatLocation(task.location)}
			</span>
		{/if}
	</div>
	<div class="px-4 pt-3">
		<LabelPicker labelIds={draft.labelIds} onchange={(labelIds) => update({ labelIds })} />
	</div>
	<div class="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pt-4 pb-24 min-h-0">
		<textarea
			aria-label="Notes"
			placeholder="Notes"
			rows="4"
			class="w-full resize-none rounded-2xl border border-transparent bg-ink/[0.04] px-3.5 py-2.5 text-[14px] outline-none touch:text-base transition-colors placeholder:text-faint focus:border-ink/15 focus:bg-surface/60"
			value={task.notes}
			oninput={(e) => update({ notes: e.currentTarget.value })}
		></textarea>
		{#if parseMemoSource(task.sourceKey)}
			<!-- A browser cannot open the phone app, so the line is not a link. -->
			<p class="flex items-center gap-1.5 text-[13px] text-muted" title="Opens on iPhone">
				<Waveform size={14} />NoteTorus
			</p>
		{/if}
		<Subtasks {task} />
	</div>
	<div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-4 pb-4">
		{#if task.completedAt === null}
			<button type="button" class="floating pointer-events-auto bg-[var(--tone-soon)]" onclick={complete}><Check size={16} weight="bold" />Complete</button>
		{:else}
			<button type="button" class="floating pointer-events-auto bg-accent" onclick={() => store.reopenTask(task.id)}><ArrowCounterClockwise size={16} weight="bold" />Reopen</button>
		{/if}
		<button type="button" class="floating pointer-events-auto bg-[var(--tone-overdue)]" aria-label="Delete task" onclick={remove}><Trash size={16} weight="bold" />Delete</button>
	</div>
</div>

<style>
	.floating {
		display: flex;
		height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		border-radius: 9999px;
		padding-inline: 1.125rem;
		font-size: 15px;
		font-weight: 600;
		color: white;
		box-shadow:
			inset 0 1px 0 0 rgb(255 255 255 / 0.3),
			0 10px 24px -10px rgb(0 0 0 / 0.45);
		transition: scale 220ms var(--ease-spring);
	}

	.floating:active {
		scale: 0.94;
	}
</style>
