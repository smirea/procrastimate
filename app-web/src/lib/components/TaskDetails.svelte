<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Trash from 'phosphor-svelte/lib/Trash';
	import Check from 'phosphor-svelte/lib/Check';
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
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
	import { push } from '../push.svelte.ts';
	import { completeTask } from '../completion.ts';

	let { task, arrival }: { task: Task; arrival: Arrival } = $props();

	const parent = $derived(task.parentId ? store.task(task.parentId) : undefined);

	let title = $state(untrack(() => task.title));
	const parsed = $derived(
		parseQuickAdd(title, { now: new Date(clock.now), projects: parent ? [] : store.projects, labels: store.labels, due: task.due }),
	);


	const update = (patch: TaskPatch) => store.updateTask(task.id, patch);

	function commitTitle() {
		if (title === task.title) return;
		if (!parsed.title) {
			title = task.title;
			return;
		}
		const reminders = [...task.reminders, ...parsed.reminders];
		const due = parsed.due ?? task.due;
		update({
			title: parsed.title,
			due,
			recurrence: parsed.recurrence ?? task.recurrence,
			priority: parsed.priority ?? task.priority,
			projectId: parsed.projectId ?? task.projectId,
			labelIds: [...new Set([...task.labelIds, ...parsed.labelIds])],
			reminders,
		});
		push.nudge(due, reminders);
		title = parsed.title;
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

<div class="flex min-h-0 flex-1 flex-col" in:fly={motion({ x: slideFrom[arrival], duration: arrival === 'none' ? 0 : 220, easing: cubicOut })}>
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
			<ProjectPicker projectId={task.projectId} onchange={(projectId) => update({ projectId })} />
		{/if}
		<div class="flex shrink-0 items-center gap-1">
			{#if task.completedAt === null}
				<button type="button" class="btn btn-quiet" onclick={complete}><Check size={14} />Complete</button>
			{:else}
				<button type="button" class="btn btn-quiet" onclick={() => store.reopenTask(task.id)}><ArrowCounterClockwise size={14} />Reopen</button>
			{/if}
			<button type="button" class="icon-btn" aria-label="Close" onclick={() => sheets.close()}>
				<X size={16} />
			</button>
		</div>
	</header>
	<div class="px-4 pt-4">
		<SmartInput bind:value={title} tokens={parsed.tokens} label="Title" enterkeyhint="done" suggestProjects={!parent} class="text-[19px] font-semibold" {onkeydown} onblur={commitTitle} />
	</div>
	<!-- Outside the scroll area, which would clip the pickers' popovers. -->
	<div class="flex flex-wrap gap-1.5 px-4 pt-3">
		<DuePicker
			due={task.due}
			onchange={(due) => {
				update({ due, recurrence: due ? task.recurrence : null });
				push.nudge(due, task.reminders);
			}}
		/>
		<RecurrencePicker
			recurrence={task.recurrence}
			due={task.due}
			onchange={(recurrence, due) => update({ recurrence, due })}
		/>
		<PriorityPicker priority={task.priority} onchange={(priority) => update({ priority })} />
		<ReminderPicker
			due={task.due}
			reminders={task.reminders}
			onchange={(reminders) => {
				update({ reminders });
				push.nudge(task.due, reminders);
			}}
		/>
	</div>
	<div class="px-4 pt-3">
		<LabelPicker labelIds={task.labelIds} onchange={(labelIds) => update({ labelIds })} />
	</div>
	<div class="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pt-4 pb-4 min-h-0">
		<textarea
			aria-label="Notes"
			placeholder="Notes"
			rows="4"
			class="w-full resize-none rounded-2xl border border-transparent bg-ink/[0.04] px-3.5 py-2.5 text-[14px] outline-none touch:text-base transition-colors placeholder:text-faint focus:border-ink/15 focus:bg-surface/60"
			value={task.notes}
			oninput={(e) => update({ notes: e.currentTarget.value })}
		></textarea>
		<Subtasks {task} />
	</div>
	<footer class="border-t border-ink/5 px-4 py-3 touch:py-2">
		<button type="button" class="btn -ml-2 text-[var(--tone-overdue)] hover:bg-[var(--token-priority)]" onclick={remove}><Trash size={14} />Delete task</button>
	</footer>
</div>
