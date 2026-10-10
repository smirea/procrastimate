<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Plus from 'phosphor-svelte/lib/Plus';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import DotsSixVertical from 'phosphor-svelte/lib/DotsSixVertical';
	import { parseQuickAdd } from 'shared/quick-add.ts';
	import type { Task } from 'shared/task.ts';
	import Checkbox from './Checkbox.svelte';
	import SmartInput from './SmartInput.svelte';
	import SubtaskProgress from './SubtaskProgress.svelte';
	import { store } from '../store.svelte.ts';
	import { clock, sheets, motion } from '../ui.svelte.ts';
	import { dueTone, formatDue } from 'shared/format.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { push } from '../push.svelte.ts';

	let { task }: { task: Task } = $props();

	const children = $derived(store.children(task.id));
	const progress = $derived(store.progress(task.id));

	let draft = $state('');
	const parsed = $derived(parseQuickAdd(draft, { now: new Date(clock.now), projects: [], labels: store.labels, due: null }));

	function add() {
		if (!parsed.title) return;
		const { title, due, recurrence, priority, reminders, labelIds } = parsed;
		store.addTask({ title, due, recurrence, priority, reminders, labelIds, projectId: null }, task.id);
		push.nudge(due, reminders);
		draft = '';
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			add();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			if (draft) draft = '';
			else sheets.close();
		}
	}

	/** Checking a subtask here toggles it in place. The checkbox is its own undo, so there is no toast. */
	function toggle(child: Task) {
		if (child.completedAt === null) store.completeTask(child.id, clock.today);
		else store.reopenTask(child.id);
	}

	let list: HTMLUListElement;
	/** While the dragged row follows the pointer, the rows it passes slide one step out of its way. */
	type Drag = { id: string; pointerId: number; startY: number; dy: number; from: number; to: number; mids: number[]; step: number };
	let drag = $state<Drag | null>(null);
	let settling = $state(false);

	function startDrag(event: PointerEvent, id: string, index: number) {
		if (event.button !== 0 || children.length < 2) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		const rects = [...list.children].map((row) => row.getBoundingClientRect());
		const step = rects[1]!.top - rects[0]!.top;
		drag = { id, pointerId: event.pointerId, startY: event.clientY, dy: 0, from: index, to: index, mids: rects.map((r) => r.top + r.height / 2), step };
	}

	function moveDrag(event: PointerEvent) {
		if (drag?.pointerId !== event.pointerId) return;
		const dy = event.clientY - drag.startY;
		const center = drag.mids[drag.from]! + dy;
		drag.dy = dy;
		drag.to = drag.mids.filter((mid, i) => i !== drag!.from && mid < center).length;
	}

	async function endDrag(event: PointerEvent, commit: boolean) {
		if (drag?.pointerId !== event.pointerId) return;
		const { id, from, to, dy, step } = drag;
		settling = true;
		drag = null;
		if (commit && to !== from) store.moveSubtask(id, to);
		const residual = dy - (commit ? (to - from) * step : 0);
		await tick();
		list.querySelector(`[data-subtask-id="${id}"]`)?.animate([{ transform: `translateY(${residual}px)` }, { transform: 'none' }], {
			duration: 200,
			easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
		});
		settling = false;
	}

	function offset(index: number, id: string) {
		if (!drag) return 0;
		if (id === drag.id) return drag.dy;
		if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.step;
		if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.step;
		return 0;
	}

	async function moveByKey(event: KeyboardEvent, id: string, index: number) {
		const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
		if (to === null) return;
		event.preventDefault();
		if (to < 0 || to >= children.length) return;
		store.moveSubtask(id, to);
		await tick();
		list.querySelector<HTMLElement>(`[data-subtask-id="${id}"] [data-handle]`)?.focus();
	}
</script>

<section aria-label="Subtasks">
	<div class="mb-1 flex items-center justify-between px-2 text-[12px] text-muted">
		<h2 class="font-medium tracking-wide uppercase">Subtasks</h2>
		{#if progress}<SubtaskProgress {progress} />{/if}
	</div>
	<ul bind:this={list} class="relative" aria-label={`Subtasks of ${task.title}`}>
		{#each children as child, index (child.id)}
			{@const done = child.completedAt !== null}
			{@const childProgress = store.progress(child.id)}
			<li
				data-subtask={child.title}
				data-subtask-id={child.id}
				class="row relative flex items-center gap-3 rounded-2xl px-2"
				class:glass-strong={drag?.id === child.id}
				class:lifted={drag?.id === child.id}
				class:shifting={!!drag && drag.id !== child.id}
				style:transform={drag ? `translateY(${offset(index, child.id)}px)` : undefined}
				animate:flip={motion({ duration: settling ? 0 : 220, easing: cubicOut })}
				in:fly={motion({ y: -6, duration: 200, easing: cubicOut })}
				out:slide={motion({ duration: 180, easing: cubicOut })}
			>
				<Checkbox checked={done} tone={PRIORITIES[child.priority].tone} label={`Complete ${child.title}`} onclick={() => toggle(child)} />
				<button type="button" class="min-w-0 flex-1 py-2 text-left touch:min-h-11 touch:py-2.5" onclick={() => sheets.openTask(child.id, 'forward')}>
					<div class="truncate text-[14px] leading-5 transition-colors" class:done>{child.title}</div>
					{#if (child.due && !done) || childProgress}
						<div class="mt-0.5 flex items-center gap-3 text-[12px] leading-4 text-muted">
							{#if child.due && !done}
								<span class="flex items-center gap-1" style={`color: var(--tone-${dueTone(child.due, clock.today)})`}>
									<CalendarBlank size={12} />{formatDue(child.due, clock.today)}
								</span>
							{/if}
							{#if childProgress}<SubtaskProgress progress={childProgress} />{/if}
						</div>
					{/if}
				</button>
				{#if children.length > 1}
					<button
						type="button"
						data-handle
						aria-label={`Reorder ${child.title}`}
						title="Drag, or use the arrow keys, to reorder"
						class="handle hit-area relative grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-full text-faint transition-colors hover:text-muted"
						onpointerdown={(e) => startDrag(e, child.id, index)}
						onpointermove={moveDrag}
						onpointerup={(e) => endDrag(e, true)}
						onpointercancel={(e) => endDrag(e, false)}
						onkeydown={(e) => moveByKey(e, child.id, index)}
					>
						<DotsSixVertical size={16} weight="bold" />
					</button>
				{/if}
			</li>
		{/each}
	</ul>
	<div class="flex items-center gap-3 px-2">
		<span class="grid size-[18px] shrink-0 place-items-center rounded-full text-accent touch:size-5"><Plus size={13} weight="bold" /></span>
		<SmartInput
			bind:value={draft}
			tokens={parsed.tokens}
			label="Add subtask"
			placeholder="Add subtask"
			enterkeyhint="enter"
			suggestProjects={false}
			class="min-w-0 flex-1 py-2 text-[14px] touch:py-3"
			{onkeydown}
		/>
	</div>
</section>

<style>
	.row {
		transition: background 150ms var(--ease-spring);
	}

	.shifting {
		transition: transform 200ms var(--ease-spring);
	}

	.lifted {
		z-index: 10;
	}

	.lifted .handle {
		cursor: grabbing;
	}

	.done {
		color: var(--color-faint);
		text-decoration: line-through;
	}
</style>
