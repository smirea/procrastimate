<script lang="ts">
	import { fade, fly, scale, slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { tick } from 'svelte';
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import ListChecks from 'phosphor-svelte/lib/ListChecks';
	import X from 'phosphor-svelte/lib/X';
	import Microphone from 'phosphor-svelte/lib/Microphone';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import CalendarStar from 'phosphor-svelte/lib/CalendarStar';
	import { parseQuickAdd, type QuickAddToken, type TokenKind } from 'shared/quick-add.ts';
	import { unknownNames, type UnknownName } from 'shared/name-search.ts';
	import { applyPickedLabels } from 'shared/triggers.ts';
	import { DEFAULT_PRIORITY, type Due, type Priority, type Recurrence, type Reminder } from 'shared/task.ts';
	import SmartInput from './SmartInput.svelte';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import ProjectPicker from './ProjectPicker.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import RecurrencePicker from './RecurrencePicker.svelte';
	import QuickAddMenu from './QuickAddMenu.svelte';
	import { rowButtons } from 'shared/quick-add-buttons.ts';
	import { WEB_BUTTONS, type WebButton } from '../quick-add-buttons.ts';
	import { store } from '../store.svelte.ts';
	import { labelStyle } from '../label-colors.ts';
	import { labelIcon } from '../label-icon.ts';
	import { creationHome } from 'shared/space-routing.ts';
	import { clock, mobile, sheets, motion } from '../ui.svelte.ts';
	import { dueTone, formatDue, formatRecurrence, formatReminder } from 'shared/format.ts';
	import { formatEvent, formatLocation } from 'shared/triggers.ts';
	import type { ListDefaults } from 'shared/screens.ts';
	import type { TaskEvent, TaskLocation } from 'shared/values.ts';
	import type { NewTask } from 'shared/store.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { parseSubtask, subtaskTask } from '../subtask-draft.ts';
	import { NAME_SOURCES } from '../names.ts';
	import { showAdded } from '../show-added.ts';

	let { defaults }: { defaults: ListDefaults } = $props();

	type Picked = {
		due: Due | null;
		priority: Priority | null;
		projectId: string | null;
		sectionId: string | null;
		labelIds: string[];
		reminders: Reminder[];
		/** Set by the repeat chip or a ramble. A typed repeat wins. */
		recurrence: Recurrence | null;
		/** Only a place or event screen sets these on the web, since picking one needs iPhone. */
		location: TaskLocation | null;
		event: TaskEvent | null;
	};
	const initialPicked = (): Picked => ({
		due: defaults.date ? { date: defaults.date, time: null } : null,
		priority: null,
		projectId: defaults.projectId,
		sectionId: defaults.sectionId,
		labelIds: defaults.labelId ? [defaults.labelId] : [],
		reminders: [],
		recurrence: null,
		location: defaults.location,
		event: defaults.event,
	});

	let text = $state('');
	let picked = $state<Picked>(initialPicked());
	/** Buttons opened from the `+` menu stay in the row for this draft, so their picker has a chip to hang from. */
	let opened = $state<WebButton[]>([]);
	let picker = $state<WebButton | null>(null);
	let row = $state<HTMLDivElement>();
	let rowReady = false;
	let edges = $state({ start: false, end: false });
	let input: SmartInput;
	let subtaskInput = $state<SmartInput>();
	let subtaskList = $state<HTMLUListElement>();
	let subtasks = $state<{ key: number; task: NewTask }[]>([]);
	let subtaskText = $state('');
	let subtasksOpen = $state(false);
	let subtaskKey = 0;
	let listAt = $state<number | null>(null);

	const showMic = $derived(!text);
	const subtaskParsed = $derived(parseSubtask(subtaskText));

	const parsed = $derived(
		parseQuickAdd(text, {
			now: new Date(clock.now),
			projects: store.projects,
			sections: store.sections,
			labels: store.labels,
			projectId: picked.projectId,
			due: picked.due,
		}),
	);
	const tokenOf = (kind: TokenKind) => parsed.tokens.find((t) => t.kind === kind);
	const recurrence = $derived(parsed.recurrence ?? picked.recurrence);
	const due = $derived(parsed.due ?? picked.due);
	const priority = $derived(parsed.priority ?? picked.priority ?? DEFAULT_PRIORITY);
	const projectId = $derived(parsed.projectId ?? picked.projectId);
	/** A typed project other than the picked one leaves the picked section behind. */
	const sectionId = $derived(parsed.sectionId ?? (projectId === picked.projectId ? picked.sectionId : null));
	const fieldTokens = $derived(parsed.tokens);
	const reminderTokens = $derived(fieldTokens.filter((t) => t.kind === 'reminder'));
	const labelTokens = $derived(
		fieldTokens
			.filter((t) => t.kind === 'label')
			.map((token) => ({ token, label: store.labels.find((l) => `@${l.name}`.toLowerCase() === token.text.toLowerCase()) })),
	);
	const labelIdOf = (token: QuickAddToken) =>
		store.labels.find((l) => `@${l.name}`.toLowerCase() === token.text.toLowerCase())?.id;
	/** A typed `@place` wins over a picked one, as typed attributes do. */
	const typedPlaceId = $derived(parsed.tokens.filter((t) => t.kind === 'place').map(labelIdOf).at(-1));
	const isPlace = (id: string) => !!store.label(id)?.place;
	/** What the labels picker shows: labels and the saved place, which saves as the task's place. */
	const labelIds = $derived([
		...new Set([
			...picked.labelIds.filter((id) => !typedPlaceId || !isPlace(id)),
			...parsed.labelIds,
			...(typedPlaceId ? [typedPlaceId] : []),
		]),
	]);
	/** The labels and place that save. A saved place checked or typed wins over the screen's place. */
	const applied = $derived(applyPickedLabels(store.labels, labelIds, picked.location));
	/** The space the task will land in. A shared one offers only its own labels and creates none, as in task details. */
	const home = $derived(creationHome(store.homes, { projectId, labelIds }, null));
	/** What each attribute holds. One with a value shows in the row even when it is not pinned. */
	const values = $derived<Partial<Record<WebButton, string>>>({
		...(due && { date: formatDue(due, clock.today) }),
		...(priority !== DEFAULT_PRIORITY && { priority: `P${priority}` }),
		...((picked.reminders.length || reminderTokens.length) && {
			reminders: `${picked.reminders.length + reminderTokens.length}`,
		}),
		...(recurrence && { repeat: formatRecurrence(recurrence, due) }),
		...(labelIds.length && { labels: store.labelsOf({ labelIds }).map((l) => l.name).join(', ') }),
		...((subtasksOpen || subtasks.length) && { subtasks: subtasks.length ? `${subtasks.length}` : 'Open' }),
	});
	/** An event stands in for the date and the repeat, as in task details. */
	const buttons = $derived(
		(rowButtons(store.quickAddButtons, [...opened, ...WEB_BUTTONS.filter((b) => values[b])], WEB_BUTTONS) as WebButton[]).filter(
			(b) => !picked.event || (b !== 'date' && b !== 'repeat'),
		),
	);
	/** Names to offer creating. The one the suggestion list is open on already offers it there. */
	const unknown = $derived(
		unknownNames(text, fieldTokens, store.projects, store.labels).filter((name) => name.start !== listAt),
	);

	function create(name: UnknownName) {
		NAME_SOURCES[name.sigil === '#' ? 'project' : 'label'].create(name.name);
		input.focus();
	}

	/**
	 * A manual pick replaces whatever the text said for that attribute. The parser shows only the last copy of a
	 * repeated phrase, so each cut reparses until no copy is left to take over from the pick.
	 */
	function clearToken(kind: TokenKind) {
		for (let token = tokenOf(kind); token; token = tokenOf(kind)) cut([token]);
		input.focus();
	}

	function cut(tokens: (QuickAddToken | undefined)[]) {
		for (const token of tokens.filter((t) => !!t).toSorted((a, b) => b.start - a.start))
			text = text.slice(0, token.start) + text.slice(token.end);
		text = text.replaceAll(/\s{2,}/g, ' ');
	}

	/**
	 * Unchecking a typed label removes its `@name`, so the picker's list is what saves. A task has one place, so
	 * checking a saved place unchecks any other, typed or picked.
	 */
	function setLabels(next: string[]) {
		const typed = parsed.labelIds;
		const place = next.filter(isPlace).at(-1);
		const placeTokens = parsed.tokens.filter((t) => t.kind === 'place' && labelIdOf(t) !== place);
		cut([...labelTokens.filter(({ token }) => !next.includes(labelIdOf(token) ?? '')).map(({ token }) => token), ...placeTokens]);
		// A label the text still types stays the text's, so deleting its `@name` later drops it.
		picked.labelIds = next.filter(
			(id) => (isPlace(id) ? id === place && id !== typedPlaceId : !typed.includes(id) || picked.labelIds.includes(id)),
		);
	}

	function setRecurrence(next: Recurrence | null, start: Due | null) {
		clearToken('recurrence');
		picked.recurrence = next;
		if (JSON.stringify(start) !== JSON.stringify(due)) {
			clearToken('due');
			picked.due = start;
		}
	}

	/** Runs a `+` menu action: the checklist opens its field, and every other button opens its picker in the row. */
	async function run(button: WebButton) {
		if (button === 'subtasks') return openSubtasks();
		if (!opened.includes(button)) opened.push(button);
		await tick();
		row?.querySelector(`[data-button="${button}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
		picker = button;
	}

	const pickerOpen = (button: WebButton) => ({
		get: () => picker === button,
		set: (open: boolean) => {
			if (open) picker = button;
			else if (picker === button) picker = null;
		},
	});
	const dueOpen = pickerOpen('date');
	const priorityOpen = pickerOpen('priority');
	const remindersOpen = pickerOpen('reminders');
	const repeatOpen = pickerOpen('repeat');
	const labelsOpen = pickerOpen('labels');

	/** A chip that appears after the row first draws, such as one the text just set, scrolls into view. */
	const intoView = (node: HTMLElement) => {
		if (rowReady) node.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
	};

	$effect(() => {
		void tick().then(() => (rowReady = true));
	});

	/** Fades whichever end of the row has more chips past it. */
	function measure() {
		if (!row) return;
		const { scrollLeft, scrollWidth, clientWidth } = row;
		edges = { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
	}

	$effect(() => {
		if (!row) return;
		void buttons.length;
		void unknown.length;
		const observer = new ResizeObserver(measure);
		observer.observe(row);
		for (const child of row.children) observer.observe(child);
		return () => observer.disconnect();
	});

	function submit() {
		if (!parsed.title) return;
		const reminders = [...parsed.reminders, ...picked.reminders];
		const { event } = picked;
		const task = store.addTask({
			title: parsed.title,
			due: event ? null : due,
			recurrence: event ? null : recurrence,
			priority,
			projectId,
			sectionId,
			labelIds: applied.labelIds,
			reminders,
			location: applied.location,
			event,
		});
		if (!task) return;
		const typing = subtaskTask(subtaskParsed);
		for (const child of [...subtasks.map((s) => s.task), ...(typing ? [typing] : [])]) store.addTask(child, task.id);
		sheets.close();
		showAdded(task);
	}

	async function openSubtasks() {
		subtasksOpen = true;
		await tick();
		subtaskInput?.focus();
	}

	async function addSubtask() {
		if (!subtaskText.trim()) return submit();
		const task = subtaskTask(subtaskParsed);
		if (!task) return;
		subtasks.push({ key: subtaskKey++, task });
		subtaskText = '';
		await tick();
		subtaskList?.scrollTo({ top: subtaskList.scrollHeight, behavior: 'smooth' });
	}

	function removeSubtask(key: number) {
		subtasks = subtasks.filter((s) => s.key !== key);
		if (!subtasks.length && !subtaskText) subtaskInput?.focus();
	}

	function onsubtaskkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void addSubtask();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			sheets.close();
		} else if (event.key === 'Backspace' && !subtaskText && !subtasks.length) {
			event.preventDefault();
			subtasksOpen = false;
			input.focus();
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			submit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			sheets.close();
		}
	}

	const enter = (node: Element) =>
		mobile.current
			? fly(node, motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 }))
			: scale(node, motion({ start: 0.96, duration: 200, easing: cubicOut, opacity: 0 }));
</script>

{#snippet trigger(Icon: typeof MapPin, name: string, kind: string, clear: () => void)}
	<span class="chip shrink-0 pr-1" data-active="true" transition:scale={motion({ start: 0.9, duration: 160 })}>
		<Icon size={15} weight="fill" />
		{name}
		<button
			type="button"
			class="grid size-6 place-items-center rounded-full text-faint transition-colors hover:text-ink touch:-my-2.5 touch:size-11"
			aria-label={`Remove ${kind}`}
			onmousedown={(e) => e.preventDefault()}
			onclick={clear}
		>
			<X size={11} weight="bold" />
		</button>
	</span>
{/snippet}

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={() => sheets.close()} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Quick add"
	class="glass-strong sheet fixed z-50 flex flex-col md:top-[14vh] md:left-1/2 md:w-[min(640px,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-panel"
	transition:enter
>
	<div class="px-4 pt-4 pb-2">
		<div class="relative">
			<SmartInput
				bind:this={input}
				bind:value={text}
				bind:listAt
				tokens={fieldTokens}
				{projectId}
				label="Task name"
				placeholder="Call mom tomorrow 5pm p1 remind me 30m before"
				autofocus
				enterkeyhint="send"
				reserve={showMic}
				lines={subtasksOpen || subtasks.length ? 4 : 12}
				class="text-[17px] font-medium"
				{onkeydown}
			/>
			{#if showMic}
				<button
					type="button"
					class="mic absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-accent text-on-accent transition-transform active:scale-90"
					aria-label="Ramble"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => sheets.openRamble(defaults)}
					transition:scale={motion({ start: 0.6, duration: 160, easing: cubicOut })}
				>
					<Microphone size={16} weight="fill" />
				</button>
			{/if}
		</div>
	</div>
	{#if subtasksOpen || subtasks.length}
		<div class="mx-4 mb-2 ml-5 border-l border-ink/10 pl-3" transition:slide={motion({ duration: 180, easing: cubicOut })}>
			<ul bind:this={subtaskList} class="max-h-48 overflow-y-auto" aria-label="Subtasks">
				{#each subtasks as { key, task } (key)}
					<li
						class="flex items-center gap-2.5"
						animate:flip={motion({ duration: 200, easing: cubicOut })}
						in:fly={motion({ y: -6, duration: 180, easing: cubicOut })}
						out:slide={motion({ duration: 160, easing: cubicOut })}
					>
						<span class="size-4 shrink-0 rounded-full border-[1.5px]" style:border-color={PRIORITIES[task.priority ?? DEFAULT_PRIORITY].tone}></span>
						<div class="min-w-0 flex-1 py-1.5">
							<div class="text-[14px] leading-5 [overflow-wrap:anywhere]">{task.title}</div>
							{#if task.due || task.recurrence || task.labelIds.length}
								<div class="flex flex-wrap items-center gap-x-3 text-[12px] leading-4 text-muted">
									{#if task.due}
										<span class="flex items-center gap-1" style={`color: var(--tone-${dueTone(task.due, clock.today)})`}>
											<CalendarBlank size={12} />{formatDue(task.due, clock.today)}
										</span>
									{/if}
									{#if task.recurrence}
										<span class="flex items-center gap-1" style="color: var(--tone-repeat)"><Repeat size={12} />{formatRecurrence(task.recurrence, task.due)}</span>
									{/if}
									{#each store.labelsOf(task) as label (label.id)}
										{@const Icon = labelIcon(label)}
										<span class="flex items-center gap-1" style={labelStyle(label.color)}><Icon size={12} weight="fill" class="text-[var(--label-tone)]" />{label.name}</span>
									{/each}
								</div>
							{/if}
						</div>
						<button
							type="button"
							class="grid size-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:text-ink touch:size-11"
							aria-label={`Remove ${task.title}`}
							onmousedown={(e) => e.preventDefault()}
							onclick={() => removeSubtask(key)}
						>
							<X size={13} weight="bold" />
						</button>
					</li>
				{/each}
			</ul>
			<div class="flex items-center gap-2.5">
				<span class="grid size-4 shrink-0 place-items-center text-accent"><Plus size={13} weight="bold" /></span>
				<SmartInput
					bind:this={subtaskInput}
					bind:value={subtaskText}
					tokens={subtaskParsed.tokens}
					label="Add subtask"
					placeholder="Add subtask"
					enterkeyhint="enter"
					suggestProjects={false}
					lines={3}
					class="-ml-1 min-w-0 flex-1 py-1.5 text-[14px]"
					onkeydown={onsubtaskkeydown}
					onblur={() => {
						if (!subtaskText && !subtasks.length) subtasksOpen = false;
					}}
				/>
			</div>
		</div>
	{/if}
	<div class="flex items-center gap-1.5 pb-3 pl-4 pr-3">
		<div
			bind:this={row}
			class="chip-row -my-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1"
			style:--fade-start={edges.start ? '20px' : '0px'}
			style:--fade-end={edges.end ? '20px' : '0px'}
			onscroll={measure}
			role="group"
			aria-label="Task attributes"
		>
			{#if applied.location}
				{@render trigger(MapPin, formatLocation(applied.location), 'place', () => {
					setLabels(labelIds.filter((id) => !isPlace(id)));
					picked.location = null;
				})}
			{/if}
			{#if picked.event}
				{@render trigger(CalendarStar, formatEvent(picked.event), 'event', () => (picked.event = null))}
			{/if}
			{#each buttons as button (button)}
				<div class="flex shrink-0 items-center gap-1.5" data-button={button} animate:flip={motion({ duration: 200, easing: cubicOut })} {@attach intoView} transition:scale={motion({ start: 0.9, duration: 160 })}>
					{#if button === 'date'}
						<DuePicker {due} bind:open={dueOpen.get, dueOpen.set} onchange={(value) => {
								clearToken('due');
								picked.due = value;
							}} />
					{:else if button === 'priority'}
						<PriorityPicker iconOnly {priority} bind:open={priorityOpen.get, priorityOpen.set} onchange={(value) => {
								clearToken('priority');
								picked.priority = value;
							}} />
					{:else if button === 'reminders'}
						<ReminderPicker {due} reminders={picked.reminders} bind:open={remindersOpen.get, remindersOpen.set} onchange={(value) => (picked.reminders = value)} />
						{#each reminderTokens as token, i (token.text + token.start)}
							<span class="chip shrink-0" data-active="true" style="color: var(--tone-week)" {@attach intoView} transition:scale={motion({ start: 0.9, duration: 160 })}>
								<Bell size={15} weight="fill" />
								{formatReminder(parsed.reminders[i]!, clock.today)}
							</span>
						{/each}
					{:else if button === 'repeat'}
						<RecurrencePicker {recurrence} {due} bind:open={repeatOpen.get, repeatOpen.set} onchange={setRecurrence} />
					{:else if button === 'labels'}
						<LabelPicker {labelIds} labels={store.dataOf(home).labels} canCreate={home === null} bind:open={labelsOpen.get, labelsOpen.set} onchange={setLabels} />
					{:else if button === 'subtasks'}
						<button
							type="button"
							class="chip"
							data-active={subtasksOpen || subtasks.length > 0}
							aria-label={subtasks.length ? `Add subtask, ${subtasks.length} added` : 'Add subtask'}
							onmousedown={(e) => e.preventDefault()}
							onclick={openSubtasks}
						>
							<ListChecks size={16} weight={subtasks.length ? 'bold' : 'regular'} />
							{#if subtasks.length}<span class="tabular-nums">{subtasks.length}</span>{/if}
						</button>
					{/if}
				</div>
			{/each}
			{#each unknown as name (name.sigil + name.name.toLowerCase())}
				<button
					type="button"
					class="chip shrink-0 text-accent"
					{@attach intoView}
					transition:scale={motion({ start: 0.9, duration: 160 })}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => create(name)}
				>
					<Plus size={15} weight="bold" />
					Create {name.sigil}{name.name}
				</button>
			{/each}
		</div>
		<QuickAddMenu {values} onrun={run} />
	</div>
	<div class="flex items-center justify-between gap-2 border-t border-ink/5 px-3 py-2.5">
		<ProjectPicker {projectId} {sectionId} onchange={(place) => {
				clearToken('section');
				clearToken('project');
				picked.projectId = place.projectId;
				picked.sectionId = place.sectionId;
			}} />
		<div class="flex gap-1.5">
			<button type="button" class="btn btn-quiet" onclick={() => sheets.close()}>Cancel</button>
			<button type="button" class="btn btn-primary" disabled={!parsed.title} onclick={submit}>Add task</button>
		</div>
	</div>
</div>

<style>
	.chip-row {
		scrollbar-width: none;
		overscroll-behavior-x: contain;
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 var(--fade-start),
			#000 calc(100% - var(--fade-end)),
			transparent
		);
	}

	.mic {
		box-shadow:
			inset 0 1px 0 0 rgb(255 255 255 / 0.3),
			0 6px 16px -6px color-mix(in srgb, var(--color-accent) 60%, transparent);
	}
</style>
