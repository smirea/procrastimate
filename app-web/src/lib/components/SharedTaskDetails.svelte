<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CalendarStar from 'phosphor-svelte/lib/CalendarStar';
	import Tray from 'phosphor-svelte/lib/Tray';
	import { formatDue, repeatLabel } from 'shared/format.ts';
	import { progressOf } from 'shared/subtasks.ts';
	import { formatEvent, scheduledDue } from 'shared/triggers.ts';
	import { DEFAULT_PRIORITY, type Task } from 'shared/task.ts';
	import LinkedText from './LinkedText.svelte';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import RecurrencePicker from './RecurrencePicker.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import ProjectGlyph from './ProjectGlyph.svelte';
	import SubtaskProgress from './SubtaskProgress.svelte';
	import TaskRow from './TaskRow.svelte';
	import { useLookup } from '../lookup.ts';
	import { reminderChipLabel } from 'shared/task-menus.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { clock } from '../clock.svelte.ts';
	import { motion } from '../motion.ts';
	import { type Arrival } from '../sheets.svelte.ts';

	/**
	 * A task reached through a public link, read only: what TaskDetails shows a view-only guest, from the link's own rows.
	 * A link carries no comments, activity, or attachments, so those sections never show.
	 */
	let { task, arrival, onclose }: { task: Task; arrival: Arrival; onclose: () => void } = $props();

	const lookup = useLookup();
	const parent = $derived(task.parentId ? lookup.task(task.parentId) : undefined);
	const project = $derived(lookup.project(task.projectId));
	const section = $derived(lookup.section(task.sectionId));
	const labels = $derived(lookup.labelsOf(task));
	const children = $derived(lookup.subtasks(task.id));
	const progress = $derived(progressOf(children, lookup.completedAt(task) !== null));
	const eventDue = $derived(task.event ? scheduledDue(task, clock.today) : null);
	const noop = () => {};
	/** The chips are inert pickers, which screen readers skip, so the same facts are read from this list instead. */
	const facts = $derived(
		[
			task.event ? `Event ${formatEvent(task.event)}${eventDue ? `, ${formatDue(eventDue, clock.today)}` : ''}` : null,
			!task.event && task.due ? `Due ${formatDue(task.due, clock.today)}` : null,
			!task.event && task.due && task.recurrence ? repeatLabel(task.recurrence, task.due) : null,
			task.priority !== DEFAULT_PRIORITY ? PRIORITIES[task.priority].label : null,
			task.reminders.length ? reminderChipLabel(task.reminders.length) : null,
			labels.length ? `Labels ${labels.map((l) => l.name).join(', ')}` : null,
		].filter((fact) => fact !== null),
	);

	const slideFrom = { forward: 28, back: -28, none: 0 } satisfies Record<Arrival, number>;
</script>

<div
	class="relative flex min-h-0 flex-1 flex-col"
	in:fly={motion({ x: slideFrom[arrival], duration: arrival === 'none' ? 0 : 220, easing: cubicOut })}
	role="group"
	aria-label={task.title}
>
	<header class="flex items-center justify-between gap-2 px-4 pt-3">
		{#if parent}
			<button type="button" class="chip min-w-0" aria-label={`Back to ${parent.title}`} onclick={() => lookup.open(parent.id, 'back')}>
				<CaretLeft size={14} class="shrink-0" /><span class="truncate">{parent.title}</span>
			</button>
		{:else}
			<span class="chip min-w-0" data-active={!!project}>
				{#if project}<ProjectGlyph {project} size={15} class="shrink-0" />{:else}<Tray size={15} class="shrink-0" />{/if}<span class="truncate">{project?.name ?? 'Inbox'}{#if section}{` / ${section.name}`}{/if}</span>
			</span>
		{/if}
		<div class="flex shrink-0 items-center gap-1">
			<span class="px-2 text-[12px] text-faint">View only</span>
			<button type="button" class="icon-btn" aria-label="Close" onclick={onclose}>
				<X size={16} />
			</button>
		</div>
	</header>
	<div class="px-4 pt-4">
		<h2 class="text-[19px] font-semibold break-words"><LinkedText text={task.title} /></h2>
	</div>
	<!-- Only what is set shows: an empty chip invites a pick this page cannot take. -->
	{#if task.event || task.due || task.priority !== DEFAULT_PRIORITY || task.reminders.length || labels.length}
		<ul class="sr-only" aria-label="Details">
			{#each facts as fact (fact)}<li>{fact}</li>{/each}
		</ul>
		<div class="flex flex-wrap gap-1.5 px-4 pt-3" inert>
			{#if task.event}
				<span class="chip" data-active="true">
					<CalendarStar size={15} weight="fill" />
					{formatEvent(task.event)}{eventDue ? ` · ${formatDue(eventDue, clock.today)}` : ''}
				</span>
			{:else if task.due}
				<DuePicker due={task.due} onchange={noop} />
				{#if task.recurrence}<RecurrencePicker recurrence={task.recurrence} due={task.due} onchange={noop} />{/if}
			{/if}
			{#if task.priority !== DEFAULT_PRIORITY}<PriorityPicker priority={task.priority} onchange={noop} />{/if}
			{#if task.reminders.length}<ReminderPicker due={eventDue ?? task.due} reminders={task.reminders} onchange={noop} />{/if}
			{#if labels.length}<LabelPicker labelIds={task.labelIds} {labels} canCreate={false} onchange={noop} />{/if}
		</div>
	{/if}
	<div class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pt-4 pb-4">
		{#if task.notes}
			<p class="rounded-2xl bg-ink/[0.04] px-3.5 py-2.5 text-[14px] whitespace-pre-wrap [overflow-wrap:anywhere] touch:text-base"><LinkedText text={task.notes} /></p>
		{/if}
		{#if children.length}
			<section aria-label="Subtasks">
				<div class="mb-1 flex items-center justify-between px-2 text-[12px] text-muted">
					<h2 class="font-medium tracking-wide uppercase">Subtasks</h2>
					{#if progress}<SubtaskProgress {progress} />{/if}
				</div>
				<ul aria-label={`Subtasks of ${task.title}`}>
					{#each children as child (child.id)}
						<li data-subtask={child.title}><TaskRow task={child} subtask /></li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</div>
