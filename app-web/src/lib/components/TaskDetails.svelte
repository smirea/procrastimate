<script lang="ts">
	import { untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Trash from 'phosphor-svelte/lib/Trash';
	import Check from 'phosphor-svelte/lib/Check';
	import { parseQuickAdd } from 'shared/quick-add.ts';
	import type { Task } from 'shared/task.ts';
	import SmartInput from './SmartInput.svelte';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import ProjectPicker from './ProjectPicker.svelte';
	import { store, type TaskPatch } from '../store.svelte.ts';
	import { clock, mobile, sheets, toasts } from '../ui.svelte.ts';
	import { requestNotificationPermission } from '../reminders.ts';

	let { task }: { task: Task } = $props();

	let title = $state(untrack(() => task.title));
	const parsed = $derived(parseQuickAdd(title, { now: new Date(clock.now), projects: store.projects, due: task.due }));

	const update = (patch: TaskPatch) => store.updateTask(task.id, patch);

	function commitTitle() {
		if (title === task.title) return;
		if (!parsed.title) {
			title = task.title;
			return;
		}
		const reminders = [...task.reminders, ...parsed.reminders];
		update({
			title: parsed.title,
			due: parsed.due ?? task.due,
			recurrence: parsed.recurrence ?? task.recurrence,
			priority: parsed.priority ?? task.priority,
			projectId: parsed.projectId ?? task.projectId,
			reminders,
		});
		requestNotificationPermission(parsed.reminders);
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
		store.setCompleted(task.id, true);
		sheets.close();
		toasts.show(`Completed “${task.title}”`, { label: 'Undo', run: () => store.setCompleted(task.id, false) });
	}

	const enter = (node: Element) =>
		mobile.current
			? fly(node, { y: '100%', duration: 300, easing: cubicOut, opacity: 1 })
			: fly(node, { x: 40, duration: 240, easing: cubicOut, opacity: 0 });
</script>

<div class="fixed inset-0 z-40 bg-zinc-900/10 backdrop-blur-[2px]" transition:fade={{ duration: 160 }} onclick={() => sheets.close()} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Task details"
	class="glass-strong sheet fixed z-50 flex flex-col md:top-3 md:right-3 md:bottom-3 md:w-[min(440px,calc(100vw-1.5rem))] md:rounded-2xl"
	transition:enter
>
	<header class="flex items-center justify-between px-4 pt-3">
		<ProjectPicker projectId={task.projectId} onchange={(projectId) => update({ projectId })} />
		<div class="flex items-center gap-1">
			<button type="button" class="btn btn-quiet" onclick={complete}><Check size={14} />Complete</button>
			<button type="button" class="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-black/5 hover:text-ink touch:size-11" aria-label="Close" onclick={() => sheets.close()}>
				<X size={16} />
			</button>
		</div>
	</header>
	<div class="sheet-scroll flex-1 space-y-4 px-4 pt-4 pb-4 md:min-h-0 md:overflow-y-auto">
		<SmartInput bind:value={title} tokens={parsed.tokens} label="Title" enterkeyhint="done" class="text-[19px] font-semibold" {onkeydown} onblur={commitTitle} />
		<textarea
			aria-label="Notes"
			placeholder="Notes"
			rows="4"
			class="w-full resize-none rounded-xl border border-black/5 bg-white/50 px-3 py-2 text-[14px] outline-none touch:text-base transition-colors placeholder:text-faint focus:border-black/15"
			value={task.notes}
			oninput={(e) => update({ notes: e.currentTarget.value })}
		></textarea>
		<div class="flex flex-wrap gap-1.5">
			<DuePicker due={task.due} onchange={(due) => update({ due })} />
			<PriorityPicker priority={task.priority} onchange={(priority) => update({ priority })} />
			<ReminderPicker
				due={task.due}
				reminders={task.reminders}
				onchange={(reminders) => {
					update({ reminders });
					requestNotificationPermission(reminders);
				}}
			/>
		</div>
	</div>
	<footer class="border-t border-black/5 px-4 py-3 touch:py-2">
		<button type="button" class="btn text-[var(--p1)] hover:bg-red-500/10" onclick={remove}><Trash size={14} />Delete task</button>
	</footer>
</div>
