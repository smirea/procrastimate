<script lang="ts">
	import Bell from 'phosphor-svelte/lib/Bell';
	import ChatCircle from 'phosphor-svelte/lib/ChatCircle';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import CalendarStar from 'phosphor-svelte/lib/CalendarStar';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import ProjectGlyph from './ProjectGlyph.svelte';
	import Tray from 'phosphor-svelte/lib/Tray';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Waveform from 'phosphor-svelte/lib/Waveform';
	import ImageSquare from 'phosphor-svelte/lib/ImageSquare';
	import ArrowElbowDownRight from 'phosphor-svelte/lib/ArrowElbowDownRight';
	import CalendarPlus from 'phosphor-svelte/lib/CalendarPlus';
	import CloudArrowUp from 'phosphor-svelte/lib/CloudArrowUp';
	import type { Snippet } from 'svelte';
	import type { Task } from 'shared/task.ts';
	import Checkbox from './Checkbox.svelte';
	import LinkedText from './LinkedText.svelte';
	import TitleFlow from './TitleFlow.svelte';
	import SubtaskProgress from './SubtaskProgress.svelte';
	import PersonName from './PersonName.svelte';
	import { useLookup } from '../lookup.ts';
	import { session } from '../session.svelte.ts';
	import { clock, reveal, motion, sheets } from '../ui.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { addedAgo, dueTone, formatDue, formatTime, repeatLabel } from 'shared/format.ts';
	import { toDateKey } from 'shared/task.ts';
	import { eventLabel, formatLocation, scheduledDue } from 'shared/triggers.ts';
	import { parseMemoSource } from 'shared/memo-tasks.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { completeTask } from '../completion.ts';
	import { progressOf } from 'shared/subtasks.ts';
	import { rowMenu, taskMenu } from '../row-menu.svelte.ts';

	let {
		task,
		showProject = false,
		timeOnly = false,
		showAdded = false,
		subtask = false,
		trailing,
	}: {
		task: Task;
		showProject?: boolean;
		timeOnly?: boolean;
		showAdded?: boolean;
		/**
		 * A row in its parent's details: it stays when done, toggles in place with no toast since the checkbox is its own
		 * undo, opens by sliding in, and wraps its whole title.
		 */
		subtask?: boolean;
		trailing?: Snippet;
	} = $props();

	const lookup = useLookup();
	let checking = $state(false);
	const editable = $derived(lookup.canEdit(task.id));
	const project = $derived(lookup.project(task.projectId));
	const section = $derived(lookup.section(task.sectionId));
	const labelChips = $derived(lookup.labelsOf(task).map((label) => ({ text: label.name, ranges: [], color: label.color })));
	const parent = $derived(task.parentId && !subtask ? lookup.task(task.parentId) : undefined);
	const subtasks = $derived(lookup.subtasks(task.id));
	/** A task left open under a completed parent is done with it. */
	const done = $derived(lookup.completedAt(task) !== null);
	const progress = $derived(progressOf(subtasks, done));
	const pending = $derived(done ? [] : subtasks.filter((s) => s.completedAt === null));
	const due = $derived(done ? null : scheduledDue(task, clock.today));
	const event = $derived(task.event ? eventLabel(task.event, clock.today) : null);
	const fromMemo = $derived(parseMemoSource(task.sourceKey) !== null);
	const commentBadge = $derived(lookup.commentBadge(task.id));
	const unsynced = $derived(lookup.unsynced(task.id));
	/** Null `createdBy` is a task the user made before the server stamped it, or an import, so it names no one. */
	const other = $derived(task.createdBy !== null && task.createdBy !== session.userId);
	const by = $derived(other ? store.person(task.createdBy) : undefined);

	const revealed = $derived(reveal.id === task.id);
	let row: HTMLElement;
	$effect(() => {
		if (revealed) row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
	});

	function complete() {
		if (subtask) {
			if (done) store.reopenTask(task.id);
			else store.completeTask(task.id, clock.today);
			return;
		}
		if (checking) return;
		checking = true;
		setTimeout(() => {
			completeTask(task);
			checking = false;
		}, 260);
	}
</script>

<div
	bind:this={row}
	class="group flex items-start gap-3 rounded-2xl px-2 transition-colors duration-500 hover:bg-surface/60"
	class:revealed
	data-task={subtask ? undefined : task.title}
	{@attach lookup.open && taskMenu(() => ({ task, toggle: subtask || !done ? complete : undefined }))}
>
	{#if editable}
		<Checkbox checked={checking || done} tone={PRIORITIES[task.priority].tone} label={`Complete ${task.title}`} class="mt-3 touch:mt-3.5" onclick={complete} />
	{:else}
		<span class="mt-3 size-[18px] shrink-0 rounded-full border-[1.5px] border-dashed border-faint/60 touch:mt-3.5 touch:size-5" aria-hidden="true"></span>
	{/if}
	<!-- The button sits under the text rather than around it, since HTML forbids a link inside a button. -->
	<div class="relative min-w-0 flex-1 py-2.5 touch:min-h-11 touch:py-3">
		{#if subtask}
			<button type="button" class="absolute inset-0 rounded-xl" aria-label={task.title} onclick={() => sheets.openTask(task.id, 'forward')}></button>
		{:else if lookup.open}
			<button type="button" class="absolute inset-0 rounded-xl" aria-label={task.title} onclick={() => lookup.open?.(task.id)}></button>
		{/if}
		<div class="pointer-events-none relative">
			<TitleFlow
				title={task.title}
				labels={labelChips}
				wrap={subtask}
				class="text-[14px] leading-5 transition-colors {checking || done ? 'text-faint line-through' : 'text-ink'}"
			/>
			{#if task.notes}
				<div class="truncate text-[12px] leading-4 text-muted"><LinkedText text={task.notes} /></div>
			{/if}
			{#if pending.length}
				<ul class="truncate text-[12px] leading-4 text-muted" aria-label="Open subtasks">
					{#each pending as item (item.id)}
						<li class="inline not-first:ml-3"><span class="text-faint" aria-hidden="true">〇</span> {item.title}</li>
					{/each}
				</ul>
			{/if}
			{#if due || task.recurrence || task.reminders.length || task.images.length || task.location || progress || commentBadge || parent || fromMemo || other || showProject}
				<div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-muted">
					{#if task.event && event && due}
						<span
							class="flex min-w-0 items-center gap-1"
							aria-label={[event.when, `${event.lead}${task.event.series ? ' every' : ''} ${event.title}${event.trail ? ` ${event.trail}` : ''}`].filter(Boolean).join(', ')}
						>
							{#if event.when}<span class="shrink-0" style={`color: var(--tone-${dueTone(due, clock.today)})`}>{event.when}</span>{/if}
							<span class="flex min-w-0 items-center gap-1 text-muted">
								{#if event.when}<span class="shrink-0">(</span>{/if}
								{#if task.event.series}<Repeat size={12} weight="bold" class="shrink-0" />{/if}
								<span class="shrink-0">{event.lead}</span>
								<CalendarStar size={12} class="shrink-0" />
								<span class="truncate">{event.title}</span>
								{#if event.trail}<span class="shrink-0">{event.trail}</span>{/if}
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
					{#if task.images.length}
						<span class="flex items-center gap-1" role="img" aria-label={task.images.length === 1 ? '1 image' : `${task.images.length} images`}>
							<ImageSquare size={12} />{task.images.length}
						</span>
					{/if}
					{#if commentBadge}
						{#if commentBadge.unread}
							<span
								class="flex items-center gap-1 font-semibold text-accent"
								data-comments="unread"
								aria-label={`${commentBadge.unread} unread of ${commentBadge.count} comments`}
								in:scale={motion({ start: 0.6, duration: 180, easing: cubicOut })}
							>
								<ChatCircle size={12} weight="fill" />{commentBadge.unread}
							</span>
						{:else}
							<span class="flex items-center gap-1" data-comments="read" aria-label={`${commentBadge.count} comments`}>
								<ChatCircle size={12} />{commentBadge.count}
							</span>
						{/if}
					{/if}
					{#if fromMemo}
						<span class="flex items-center" role="img" aria-label="From Notouroboros">
							<Waveform size={12} />
						</span>
					{/if}
					{#if other}
						<span class="flex min-w-0 items-center gap-1" aria-label={`Created by ${by?.name ?? 'someone else'}`}>
							by <PersonName person={by} class="text-ink" />
						</span>
					{/if}
					{#if parent}
						<span class="flex min-w-0 items-center gap-1" aria-label={`Subtask of ${parent.title}`}>
							<ArrowElbowDownRight size={12} class="shrink-0" /><span class="truncate">{parent.title}</span>
						</span>
					{/if}
					{#if showProject}
						<span class="ml-auto flex shrink-0 items-center gap-1">
							{#if project}<ProjectGlyph {project} size={12} />{project.name}{#if section}{` / ${section.name}`}{/if}{:else}<Tray size={12} />Inbox{/if}
						</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
	{#if unsynced}
		<span
			class="shrink-0 pt-3 text-faint touch:pt-3.5"
			role="img"
			aria-label="Not synced yet"
			data-unsynced
			transition:scale={motion({ start: 0.6, duration: 180, easing: cubicOut })}
		>
			<CloudArrowUp size={14} />
		</span>
	{/if}
	{#if showAdded}
		<span class="shrink-0 pt-3 text-[12px] leading-5 text-faint touch:pt-3.5">{addedAgo(toDateKey(new Date(task.createdAt)), clock.today)}</span>
	{/if}
	{#if !task.event && editable && !done}
		<div class="mt-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
			<button
				type="button"
				class="hit-area relative grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5"
				aria-label={`Postpone ${task.title}`}
				onclick={(event) => rowMenu.openBelow({ task }, event.currentTarget, 'postpone')}
			>
				<CalendarPlus size={16} />
			</button>
		</div>
	{/if}
	{@render trailing?.()}
</div>

<style>
	.revealed {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
</style>
