<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import { onDestroy, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Trash from 'phosphor-svelte/lib/Trash';
	import Check from 'phosphor-svelte/lib/Check';
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CalendarStar from 'phosphor-svelte/lib/CalendarStar';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import Waveform from 'phosphor-svelte/lib/Waveform';
	import ShareNetwork from 'phosphor-svelte/lib/ShareNetwork';
	import ProjectGlyph from './ProjectGlyph.svelte';
	import Tray from 'phosphor-svelte/lib/Tray';
	import CloudArrowUp from 'phosphor-svelte/lib/CloudArrowUp';
	import TextT from 'phosphor-svelte/lib/TextT';
	import { projectsInOrder } from 'shared/store.ts';
	import { formatDue } from 'shared/format.ts';
	import { applyPickedLabels, formatEvent, formatLocation, formatRadius, pickedLabels, scheduledDue } from 'shared/triggers.ts';
	import { parseMemoSource } from 'shared/memo-tasks.ts';
	import { commitTitle, parseTitle, setDue, titleDraft, titleTokens } from 'shared/task-details.ts';
	import type { Task } from 'shared/task.ts';
	import SmartInput from './SmartInput.svelte';
	import LinkedField from './LinkedField.svelte';
	import LinkedText from './LinkedText.svelte';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import RecurrencePicker from './RecurrencePicker.svelte';
	import ProjectPicker from './ProjectPicker.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import Subtasks from './Subtasks.svelte';
	import TaskAttachments from './TaskAttachments.svelte';
	import TaskGithub from './TaskGithub.svelte';
	import TaskActivity from './TaskActivity.svelte';
	import TaskComments from './TaskComments.svelte';
	import PersonName from './PersonName.svelte';
	import CopyButton from './CopyButton.svelte';
	import { store, type TaskPatch } from '../store.svelte.ts';
	import { clock } from '../clock.svelte.ts';
	import { sheets, type Arrival } from '../sheets.svelte.ts';
	import { motion } from '../motion.ts';
	import { completeTask, deleteTask } from '../completion.ts';
	import { attachments, droppedFiles } from '../attachments/attachments.svelte.ts';
	import { unsynced } from '../unsynced.svelte.ts';

	const NOTES_PAUSE_MS = 400;

	let { task, arrival }: { task: Task; arrival: Arrival } = $props();
	// TaskSheet keys details by task id, so it never changes. While the sheet animates out after closing, `task` already
	// reads undefined, yet the body still gets scroll events.
	const id = untrack(() => task.id);

	const parent = $derived(task.parentId ? store.task(task.parentId) : undefined);
	const home = $derived(store.homeOf(id));
	const space = $derived(store.dataOf(home));
	const owner = $derived(home ? store.ownerOf(home) : undefined);
	const editable = $derived(store.canEdit(id));
	const project = $derived(store.project(task.projectId));
	const section = $derived(store.section(task.sectionId));

	/** Quick add expanded with no title yet, so the title is the first thing to type. */
	const untitled = untrack(() => task.title === '');
	let typed = $state<string | null>(null);
	const title = $derived(typed ?? task.title);
	const literal = $derived(task.titleMode === 'literal');
	const edited = $derived(title !== task.title);
	// Only an edited title is parsed: every command replaces the space, and parsing on each would rerun the parser on
	// every change made anywhere while the sheet is open.
	const parsed = $derived(edited ? parseTitle(title, task, { now: new Date(clock.now), ...space }) : null);
	const tokens = $derived(titleTokens(task, title, parsed));
	const draft = $derived(titleDraft(task, title, parsed));

	const update = (patch: TaskPatch) => store.updateTask(id, patch);

	/**
	 * Notes typed but not saved yet. Saving each keystroke ran a whole command, a local write and read back, and a sync
	 * that made every other device pull, so typing saves once it pauses, and on blur, close, or the page hiding.
	 */
	let notesTyped = $state<string | null>(null);
	const notes = $derived(notesTyped ?? task.notes);
	let notesTimer: ReturnType<typeof setTimeout> | undefined;
	function commitNotes() {
		clearTimeout(notesTimer);
		if (notesTyped === null) return;
		const next = notesTyped;
		notesTyped = null;
		if (store.task(id) && next !== store.task(id)!.notes) update({ notes: next });
	}
	function typeNotes(value: string) {
		notesTyped = value;
		clearTimeout(notesTimer);
		notesTimer = setTimeout(commitNotes, NOTES_PAUSE_MS);
	}
	onDestroy(commitNotes);
	const eventDue = $derived(task.event ? scheduledDue(task, clock.today) : null);

	function saveTitle() {
		const commit = commitTitle(task, title, parsed);
		if (commit.kind === 'update') update(commit.patch);
		typed = null;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			saveTitle();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			// Throwing away the only title a new task has would delete it, so Escape keeps what was typed there.
			if (task.title === '') saveTitle();
			typed = null;
			sheets.close();
		}
	}

	function leave(parentId: string | null) {
		if (parentId) sheets.openTask(parentId, 'back');
		else sheets.close();
	}

	function remove() {
		const { parentId } = task;
		deleteTask(task);
		leave(parentId);
	}

	function complete() {
		const { parentId } = task;
		completeTask(task);
		leave(parentId);
	}

	const slideFrom = { forward: 28, back: -28, none: 0 } satisfies Record<Arrival, number>;

	let body: HTMLDivElement;

	$effect(() => {
		if (untrack(() => arrival) === 'back') body.scrollTop = sheets.scrollTops.get(id) ?? 0;
	});

	const carriesFiles = (event: DragEvent) => editable && !!event.dataTransfer?.types.includes('Files');

	function onpaste(event: ClipboardEvent) {
		const files = droppedFiles(event.clipboardData);
		if (!editable || !files.length) return;
		event.preventDefault();
		void attachments.attach(id, files);
	}

	let dropping = $state(false);

	function ondragover(event: DragEvent) {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		dropping = true;
	}

	function ondragleave(event: DragEvent) {
		const inside = event.relatedTarget instanceof Node && (event.currentTarget as Node).contains(event.relatedTarget);
		if (!inside) dropping = false;
	}

	function ondrop(event: DragEvent) {
		dropping = false;
		if (!carriesFiles(event)) return;
		event.preventDefault();
		void attachments.attach(id, droppedFiles(event.dataTransfer));
	}
</script>

<svelte:window onpagehide={commitNotes} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && commitNotes()} />
<div
	{@attach feedback()}
	class="relative flex min-h-0 flex-1 flex-col"
	in:fly={motion({ x: slideFrom[arrival], duration: arrival === 'none' ? 0 : 220, easing: cubicOut })}
	{onpaste}
	{ondragover}
	{ondragleave}
	{ondrop}
	role="group"
	aria-label={task.title}
>
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
		{:else if editable}
			<ProjectPicker
				projectId={draft.projectId}
				sectionId={draft.sectionId}
				projects={projectsInOrder(space.projects)}
				sections={space.sections}
				canCreate={home === null}
				onchange={(place) => update(place)}
			/>
		{:else}
			<span class="chip min-w-0" data-active={!!project}>
				{#if project}<ProjectGlyph {project} size={15} class="shrink-0" />{:else}<Tray size={15} class="shrink-0" />{/if}<span class="truncate">{project?.name ?? 'Inbox'}{#if section}{` / ${section.name}`}{/if}</span>
			</span>
		{/if}
		<div class="flex shrink-0 items-center gap-1">
			{#if !editable}
				<span class="px-2 text-[12px] text-faint">View only</span>
			{/if}
			{#if home === null}
				<button type="button" class="icon-btn" aria-label="Share task" onclick={() => sheets.openShare({ kind: 'task', id }, task.title, id)}>
					<ShareNetwork size={16} />
				</button>
			{/if}
			<CopyButton label="Copy task as Markdown" markdown={() => ({ title: null, sections: [{ heading: null, tasks: [task] }] })} />
			<button type="button" class="icon-btn" aria-label="Close" onclick={() => sheets.close()}>
				<X size={16} />
			</button>
		</div>
	</header>
	<div class="relative px-4 pt-4">
		{#if unsynced.has(id)}
			<p class="absolute top-0 left-5 flex items-center gap-1 text-[11px] leading-4 text-muted" role="status" data-unsynced transition:fade={motion({ duration: 150 })}>
				<CloudArrowUp size={12} />Not saved yet. Will sync when online.
			</p>
		{/if}
		{#if owner}
			<p class="mb-1 flex items-center gap-1 text-[12px] text-faint">Shared by <PersonName person={owner} /></p>
		{/if}
		{#if editable}
			<LinkedField text={title} class="px-1 py-0.5 text-[19px] leading-[1.6] font-semibold whitespace-pre-wrap [overflow-wrap:anywhere]">
				<SmartInput bind:value={() => title, (value) => (typed = value)} autofocus={untitled} placeholder="Task name" {tokens} projectId={draft.projectId} label="Title" enterkeyhint="done" suggestProjects={!parent && !literal} suggestNames={!literal} class="text-[19px] font-semibold" {onkeydown} onblur={saveTitle} />
			</LinkedField>
		{:else}
			<h2 class="text-[19px] font-semibold break-words"><LinkedText text={task.title} /></h2>
		{/if}
	</div>
	<!-- Outside the scroll area, which would clip the pickers' popovers. A read-only task keeps the chips as plain facts. -->
	<div class="flex flex-wrap gap-1.5 px-4 pt-3" inert={!editable}>
		<!-- Keeps the title focused, so turning it on mid-edit stops the typed phrases from applying instead of saving them. -->
		<button
			type="button"
			class="chip data-[active=true]:bg-accent/15 data-[active=true]:text-accent"
			data-active={literal}
			aria-pressed={literal}
			aria-label="Plain text"
			title="Plain text: editing the title never applies its dates, times, or tags"
			onmousedown={(e) => e.preventDefault()}
			onclick={() => update({ titleMode: literal ? 'parse' : 'literal' })}
		>
			<TextT size={15} weight={literal ? 'bold' : 'regular'} />
		</button>
		{#if task.event}
			<span class="chip" data-active="true" title="Set on iPhone">
				<CalendarStar size={15} weight="fill" />
				{formatEvent(task.event)}{eventDue ? ` · ${formatDue(eventDue, clock.today)}` : ''}
			</span>
		{:else}
			<DuePicker
				due={draft.due}
				onchange={(due) => update(setDue(task, due))}
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
		{#if draft.location}
			<span class="chip" data-active="true" title={`${draft.location.address ?? draft.location.name} · Set on iPhone or as a saved place`}>
				<MapPin size={15} weight="fill" />
				{formatLocation(draft.location)}
				<span class="text-muted">{formatRadius(draft.location.radius)}</span>
			</span>
		{/if}
	</div>
	<TaskGithub {task} {editable} onchange={(github) => update({ github })} />
	<div class="px-4 pt-3" inert={!editable}>
		<LabelPicker
			labelIds={pickedLabels(space.labels, draft)}
			labels={space.labels}
			canCreate={home === null}
			onchange={(ids) => update(applyPickedLabels(space.labels, ids, task.location))}
		/>
	</div>
	<div
		bind:this={body}
		class="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pt-4 min-h-0"
		class:pb-24={editable}
		class:pb-4={!editable}
		onscroll={(e) => sheets.scrollTops.set(id, e.currentTarget.scrollTop)}
	>
		{#if editable}
			<LinkedField text={notes} class="border border-transparent px-3.5 py-2.5 text-[14px] whitespace-pre-wrap [overflow-wrap:anywhere] touch:text-base">
				<textarea
					aria-label="Notes"
					placeholder="Notes"
					class="block min-h-[6.5rem] w-full resize-none [field-sizing:content] rounded-2xl border border-transparent bg-ink/[0.04] px-3.5 py-2.5 text-[14px] outline-none touch:text-base transition-colors placeholder:text-faint focus:border-ink/15 focus:bg-surface/60"
					value={notes}
					oninput={(e) => typeNotes(e.currentTarget.value)}
					onblur={commitNotes}
				></textarea>
			</LinkedField>
		{:else if task.notes}
			<p class="rounded-2xl bg-ink/[0.04] px-3.5 py-2.5 text-[14px] whitespace-pre-wrap [overflow-wrap:anywhere] touch:text-base"><LinkedText text={task.notes} /></p>
		{/if}
		{#if parseMemoSource(task.sourceKey)}
			<!-- A browser cannot open the phone app, so the line is not a link. -->
			<p class="flex items-center gap-1.5 text-[13px] text-muted" title="Opens on iPhone">
				<Waveform size={14} />Notouroboros
			</p>
		{/if}
		<TaskAttachments {task} {home} {editable} />
		{#if editable || store.children(id).length}<Subtasks {task} />{/if}
		<TaskComments {task} {home} />
		<TaskActivity {task} {home} />
	</div>
	{#if editable}
		<div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-4 pb-4">
			{#if store.completedAt(task) === null}
				<button type="button" class="floating pointer-events-auto bg-[var(--tone-soon)]" onclick={complete}><Check size={16} weight="bold" />Complete</button>
			{:else}
				<button type="button" class="floating pointer-events-auto bg-accent" onclick={() => store.reopenTask(id)}><ArrowCounterClockwise size={16} weight="bold" />Reopen</button>
			{/if}
			<button type="button" class="floating pointer-events-auto bg-[var(--tone-overdue)]" aria-label="Delete task" onclick={remove}><Trash size={16} weight="bold" />Delete</button>
		</div>
	{/if}
	{#if dropping}
		<div class="drop pointer-events-none absolute inset-2 grid place-items-center rounded-[1.25rem] text-[14px] font-medium text-accent" transition:fade={motion({ duration: 120 })}>
			Drop to attach
		</div>
	{/if}
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

	.drop {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-accent) 55%, transparent);
		backdrop-filter: blur(2px);
	}
</style>
