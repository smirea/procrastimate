<script lang="ts">
	import { untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Trash from 'phosphor-svelte/lib/Trash';
	import Check from 'phosphor-svelte/lib/Check';
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import { parseQuickAdd } from 'shared/quick-add.ts';
	import { alignToRecurrence, type Task } from 'shared/task.ts';
	import SmartInput from './SmartInput.svelte';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import RecurrencePicker from './RecurrencePicker.svelte';
	import ProjectPicker from './ProjectPicker.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import { store, type TaskPatch } from '../store.svelte.ts';
	import { clock, mobile, sheets, toasts } from '../ui.svelte.ts';
	import { push } from '../push.svelte.ts';
	import { describeTiming } from '../format.ts';
	import { completeTask } from '../completion.ts';

	let { task }: { task: Task } = $props();

	let title = $state(untrack(() => task.title));
	const parsed = $derived(
		parseQuickAdd(title, { now: new Date(clock.now), projects: store.projects, labels: store.labels, due: task.due }),
	);

	const timing = $derived(
		parsed.due || parsed.recurrence || parsed.reminders.length
			? describeTiming(
					{ due: parsed.due ?? task.due, recurrence: parsed.recurrence ?? task.recurrence, reminders: [...task.reminders, ...parsed.reminders] },
					clock.today,
				)
			: [],
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

	function remove() {
		const snapshot = $state.snapshot(task);
		store.deleteTask(task.id);
		sheets.close();
		toasts.show(`Deleted “${snapshot.title}”`, { label: 'Undo', run: () => store.restoreTask(snapshot) });
	}

	function complete() {
		completeTask(task);
		sheets.close();
	}

	const enter = (node: Element) =>
		mobile.current
			? fly(node, { y: '100%', duration: 300, easing: cubicOut, opacity: 1 })
			: fly(node, { x: 40, duration: 240, easing: cubicOut, opacity: 0 });
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={{ duration: 160 }} onclick={() => sheets.close()} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Task details"
	class="glass-strong sheet fixed z-50 flex flex-col md:top-3 md:right-3 md:bottom-3 md:w-[min(440px,calc(100vw-1.5rem))] md:rounded-2xl"
	transition:enter
>
	<header class="flex items-center justify-between px-4 pt-3">
		<ProjectPicker projectId={task.projectId} onchange={(projectId) => update({ projectId })} />
		<div class="flex items-center gap-1">
			{#if task.completedAt === null}
				<button type="button" class="btn btn-quiet" onclick={complete}><Check size={14} />Complete</button>
			{:else}
				<button type="button" class="btn btn-quiet" onclick={() => store.reopenTask(task.id)}><ArrowCounterClockwise size={14} />Reopen</button>
			{/if}
			<button type="button" class="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink touch:size-11" aria-label="Close" onclick={() => sheets.close()}>
				<X size={16} />
			</button>
		</div>
	</header>
	<div class="px-4 pt-4">
		<SmartInput bind:value={title} tokens={parsed.tokens} {timing} label="Title" enterkeyhint="done" class="text-[19px] font-semibold" {onkeydown} onblur={commitTitle} />
	</div>
	<!-- Outside the scroll area, which clips popovers while the keyboard is up and the picker's field raises it. -->
	<div class="px-4 pt-3">
		<LabelPicker labelIds={task.labelIds} onchange={(labelIds) => update({ labelIds })} />
	</div>
	<div class="sheet-scroll flex-1 space-y-4 px-4 pt-4 pb-4 md:min-h-0 md:overflow-y-auto">
		<textarea
			aria-label="Notes"
			placeholder="Notes"
			rows="4"
			class="w-full resize-none rounded-xl border border-ink/5 bg-surface/50 px-3 py-2 text-[14px] outline-none touch:text-base transition-colors placeholder:text-faint focus:border-ink/15"
			value={task.notes}
			oninput={(e) => update({ notes: e.currentTarget.value })}
		></textarea>
		<div class="flex flex-wrap gap-1.5">
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
				onchange={(recurrence) => {
					const base = task.due ?? { date: clock.today, time: null };
					update({ recurrence, due: recurrence ? { ...base, date: alignToRecurrence(base.date, recurrence) } : task.due });
				}}
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
	</div>
	<footer class="border-t border-ink/5 px-4 py-3 touch:py-2">
		<button type="button" class="btn text-[var(--tone-overdue)] hover:bg-[var(--token-priority)]" onclick={remove}><Trash size={14} />Delete task</button>
	</footer>
</div>
