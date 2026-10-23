<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { backOut, cubicOut } from 'svelte/easing';
	import { onMount, tick } from 'svelte';
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import Flag from 'phosphor-svelte/lib/Flag';
	import ProjectGlyph from '../components/ProjectGlyph.svelte';
	import Microphone from 'phosphor-svelte/lib/Microphone';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Sparkle from 'phosphor-svelte/lib/Sparkle';
	import Command from 'phosphor-svelte/lib/Command';
	import X from 'phosphor-svelte/lib/X';
	import { parseRamble, resolveOutline, type RambleTask, type RambleToken } from 'shared/ramble.ts';
	import type { RambleOutline } from 'shared/ramble/outline.ts';
	import type { RambleMode } from 'shared/dictation.ts';
	import { toDateKey, toTimeOfDay } from 'shared/task.ts';
	import { api } from '../api.ts';
	import { Outliner, smartTasks } from './outliner.ts';
	import { rambleNewTask } from 'shared/ramble-fill.ts';
	import { creationHome } from 'shared/space-routing.ts';
	import { DEFAULT_PRIORITY } from 'shared/task.ts';
	import { dueTone, formatDue, formatRecurrence, formatReminder } from 'shared/format.ts';
	import DuePicker from '../components/DuePicker.svelte';
	import PriorityPicker from '../components/PriorityPicker.svelte';
	import ProjectPicker from '../components/ProjectPicker.svelte';
	import LabelPicker from '../components/LabelPicker.svelte';
	import { store } from '../store.svelte.ts';
	import { labelStyle } from '../label-colors.ts';
	import { labelIcon } from '../label-icon.ts';
	import { clock, mobile, motion, sheets, toasts } from '../ui.svelte.ts';
	import type { ListDefaults } from 'shared/screens.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { showAdded } from '../show-added.ts';
	import { addableLabels, addableProjects } from '../screen.ts';
	import { listenRamble, type CaptureStop, type RambleListen } from './capture.ts';
	import { caption, keyed, type RambleEntry } from './entries.ts';
	import Waveform, { type LevelMeter } from './Waveform.svelte';

	let { defaults }: { defaults: ListDefaults } = $props();

	/**
	 * One capture at a time. `structuring` waits on Gemini's final outline. `review` holds the reviewed list, and
	 * talking again appends to it.
	 */
	type Phase = 'listening' | 'finishing' | 'structuring' | 'review';

	const HINTS: Record<RambleMode, string[]> = {
		smart: [
			'Call mom tomorrow at 5pm, priority one',
			'Plan the trip: book flights and find a hotel',
			'Pay rent on Friday, actually make that Thursday',
		],
		commands: [
			'“New task” starts a task, “subtask” a subtask',
			'“Note” adds notes, “priority one” sets a priority',
			'“Scratch that” drops it, “that’s all” stops',
		],
	};

	/** Past this the last outline stands, with the grammar's tasks for the words after it. */
	const SETTLE_TIMEOUT_MS = 6000;

	const NOTICES: Partial<Record<CaptureStop, string>> = {
		denied: 'The microphone is off. You can type the tasks instead.',
		limit: "Ramble's daily limit is used up",
		unavailable: 'Ramble needs a connection',
		error: 'Dictation stopped. You can type the task instead.',
		unsupported: 'Dictation stopped. You can type the task instead.',
	};

	let phase = $state<Phase>('listening');
	let entries = $state<RambleEntry[]>([]);
	let live = $state.raw<RambleEntry[]>([]);
	let transcript = $state('');
	let tokens = $state.raw<RambleToken[]>([]);
	let open = $state<string | null>(null);
	let notice = $state('');
	let elapsed = $state(0);
	let scroller = $state<HTMLDivElement>();
	let session: RambleListen | null = null;
	let outliner: Outliner | null = null;
	/** The last settled capture, which switching the mode reads again. */
	let capture: { transcript: string; keys: string[] } | null = null;
	let generation = 0;
	let nextKey = 0;
	const meter: LevelMeter = { level: 0 };

	const items = $derived([...entries, ...live]);
	const saving = $derived(entries.filter((entry) => entry.title.trim()));
	const subtaskCount = $derived(saving.reduce((sum, entry) => sum + entry.subtasks.length, 0));
	const captionParts = $derived(caption(transcript, tokens));
	const listening = $derived(phase !== 'review');
	const mode = $derived(store.rambleMode);

	/** Ramble names every space's projects and labels a task may land on, as quick add does. */
	const names = $derived({ projects: addableProjects(), labels: addableLabels() });
	const options = () => ({ now: new Date(clock.now), ...names });
	const grammar = (text: string) => parseRamble(text, { ...options(), commands: mode === 'commands' });
	const resolve = (outline: RambleOutline) => resolveOutline(outline, options());

	/** Null offline: the grammar's tasks stand without a round trip. */
	function newOutliner(token: number): Outliner | null {
		if (!navigator.onLine) return null;
		return new Outliner(
			(text, signal) => {
				const now = new Date(clock.now);
				return api.ramble.outline(
					{
						transcript: text,
						today: toDateKey(now),
						time: toTimeOfDay(now.getHours(), now.getMinutes()),
						projects: names.projects.map((project) => project.name),
						labels: names.labels.map((label) => label.name),
					},
					{ signal },
				);
			},
			() => {
				if (token === generation && (phase === 'listening' || phase === 'finishing')) showLive();
			},
		);
	}

	function showLive() {
		const tasks =
			mode === 'commands'
				? grammar(transcript).tasks
				: smartTasks(transcript, outliner?.latest ?? null, (text) => grammar(text).tasks, resolve);
		void follow(() => (live = keyed(tasks, nextKey)));
	}

	/** What a finished transcript reads as in the current mode, or null when a newer capture took over. */
	async function read(text: string, token: number): Promise<RambleTask[] | null> {
		if (mode === 'commands' || !text.trim()) return grammar(text).tasks;
		outliner ??= newOutliner(token);
		if (!outliner || outliner.off) return grammar(text).tasks;
		phase = 'structuring';
		const outline = await outliner.settle(text, SETTLE_TIMEOUT_MS);
		if (token !== generation) return null;
		return outline ? resolve(outline) : smartTasks(text, outliner.latest, (rest) => grammar(rest).tasks, resolve);
	}

	/** Switching reads the capture in progress, or the last one, again; edits to its tasks give way to the new read. */
	async function setMode(next: RambleMode) {
		if (next === mode || phase === 'structuring') return;
		store.setRambleMode(next);
		if (phase === 'listening' || phase === 'finishing') {
			if (next === 'smart') {
				outliner ??= newOutliner(generation);
				outliner?.update(transcript);
			}
			showLive();
			return;
		}
		const previous = capture;
		if (!previous) return;
		const at = entries.findIndex((entry) => previous.keys.includes(entry.key));
		const tasks = await read(previous.transcript, generation);
		if (!tasks || capture !== previous) return;
		const settled = keyed(tasks, nextKey);
		nextKey += settled.length;
		const kept = entries.filter((entry) => !previous.keys.includes(entry.key));
		const index = at < 0 ? kept.length : at;
		entries = [...kept.slice(0, index), ...settled, ...kept.slice(index)];
		capture = { transcript: previous.transcript, keys: settled.map((entry) => entry.key) };
		phase = 'review';
	}

	/** The space an entry will land in, whose labels its picker lists and creates in. */
	const landing = (entry: RambleEntry) => creationHome(store.homes, rambleNewTask(entry, defaults, store.labels), null);

	function start() {
		const token = ++generation;
		phase = 'listening';
		transcript = '';
		tokens = [];
		live = [];
		notice = '';
		open = null;
		elapsed = 0;
		meter.level = 0;
		outliner?.stop();
		outliner = mode === 'smart' ? newOutliner(token) : null;
		const began = performance.now();
		let ended = false;
		const timer = setInterval(() => (elapsed = Math.floor((performance.now() - began) / 1000)), 250);
		const next = listenRamble({
			choice: store.dictation,
			online: navigator.onLine,
			onLevel: (level) => (meter.level = level),
			onText: (spoken) => {
				if (token !== generation || phase === 'review') return;
				const draft = grammar(spoken);
				transcript = spoken;
				tokens = draft.tokens;
				if (mode === 'smart') outliner?.update(spoken);
				showLive();
				if (draft.ended) stop();
			},
			onStop: (reason, message) => {
				clearInterval(timer);
				ended = true;
				if (token !== generation) return;
				session = null;
				notice = reason === 'stopped' ? '' : (message ?? NOTICES[reason] ?? '');
				void settle(token);
			},
		});
		if (ended) return;
		session = next;
		if (next.typed) {
			clearInterval(timer);
			session = null;
			phase = 'review';
			notice = 'Dictation is not available here. You can type the tasks instead.';
		}
	}

	function stop() {
		if (phase !== 'listening') return;
		phase = 'finishing';
		session?.stop();
	}

	/** The final transcript, not the last partial, decides the tasks. Keys carry over, so rows stay where they are. */
	async function settle(token: number) {
		meter.level = 0;
		const text = transcript;
		const tasks = await read(text, token);
		if (!tasks) return;
		const settled = keyed(tasks, nextKey);
		nextKey += settled.length;
		live = [];
		entries.push(...settled);
		capture = { transcript: text, keys: settled.map((entry) => entry.key) };
		phase = 'review';
	}

	/** Keeps the newest task in view while it streams in, unless the list was scrolled up to read. */
	async function follow(update: () => void) {
		const node = scroller;
		const pinned = !node || node.scrollHeight - node.scrollTop - node.clientHeight < 96;
		update();
		await tick();
		if (pinned) node?.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
	}

	function remove(key: string) {
		const prune = (list: RambleEntry[]): RambleEntry[] =>
			list.filter((entry) => entry.key !== key).map((entry) => ({ ...entry, subtasks: prune(entry.subtasks) }));
		entries = prune(entries);
		if (open === key) open = null;
	}

	function save() {
		if (listening || !saving.length) return;
		const added = saving.flatMap((entry) => {
			const task = store.addTask(rambleNewTask(entry, defaults, store.labels));
			if (!task) return [];
			if (entry.notes) store.updateTask(task.id, { notes: entry.notes });
			addSubtasks(entry.subtasks, task.id);
			return [task];
		});
		sheets.close();
		if (added[0]) showAdded(added[0]);
		if (added.length > 1) toasts.show(`Added ${added.length} tasks`);
	}

	function addSubtasks(subtasks: RambleEntry[], parentId: string) {
		for (const subtask of subtasks) {
			if (!subtask.title.trim()) continue;
			const child = store.addTask(rambleNewTask(subtask, null, store.labels), parentId);
			if (!child) continue;
			if (subtask.notes) store.updateTask(child.id, { notes: subtask.notes });
			addSubtasks(subtask.subtasks, child.id);
		}
	}

	function close() {
		generation++;
		outliner?.stop();
		session?.stop();
		sheets.close();
	}

	function typeInstead() {
		generation++;
		outliner?.stop();
		session?.stop();
		sheets.openQuickAdd(defaults);
	}

	const isTyping = (target: EventTarget | null) =>
		target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

	/** Runs before the layout's Escape, which would close the drawer while it is still listening. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && (phase === 'listening' || open)) {
			event.preventDefault();
			event.stopPropagation();
			if (phase === 'listening') stop();
			else open = null;
		} else if (event.key === 'Enter' && !event.shiftKey && phase === 'review' && !isTyping(event.target) && !(event.target instanceof HTMLButtonElement)) {
			event.preventDefault();
			save();
		} else if (event.key === ' ' && !isTyping(event.target) && !(event.target instanceof HTMLButtonElement)) {
			event.preventDefault();
			if (phase === 'listening') stop();
			else if (phase === 'review') start();
		}
	}

	onMount(() => {
		start();
		return () => {
			generation++;
			outliner?.stop();
			session?.stop();
		};
	});

	const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

	const enter = (node: Element) =>
		mobile.current
			? fly(node, motion({ y: '100%', duration: 420, easing: cubicOut, opacity: 1 }))
			: scale(node, motion({ start: 0.98, duration: 260, easing: cubicOut, opacity: 0 }));

	/** Rows rise into place out of a soft blur, like a thought coming into focus. */
	function arrive(node: Element, { delay = 0, y = 14 }: { delay?: number; y?: number } = {}) {
		return motion({
			delay,
			duration: 380,
			easing: cubicOut,
			css: (t: number, u: number) => `opacity: ${t}; transform: translateY(${u * y}px); filter: blur(${u * 6}px)`,
		});
	}

	function word(node: Element) {
		return motion({
			duration: 240,
			easing: cubicOut,
			css: (t: number, u: number) => `opacity: ${t}; filter: blur(${u * 4}px); display: inline-block; transform: translateY(${u * 3}px)`,
		});
	}

	const pop = (node: Element) => scale(node, motion({ start: 0.5, duration: 340, easing: backOut }));
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div
	role="dialog"
	aria-label="Ramble"
	aria-modal="true"
	class="ramble glass-strong fixed inset-0 z-50 flex flex-col"
	transition:enter
>
	<header class="mx-auto grid w-full max-w-[600px] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
		<button type="button" class="icon-btn justify-self-start" aria-label="Close" onclick={close}>
			<X size={18} weight="bold" />
		</button>
		<div class="flex items-center justify-center gap-2 text-[13px] font-medium text-muted tabular-nums" aria-live="polite">
			{#if phase === 'listening'}
				<span class="pulse size-2 rounded-full bg-accent"></span>
				<span>Listening</span>
				<span class="text-faint">{clockText(elapsed)}</span>
			{:else if phase === 'finishing'}
				<span>Catching the last words…</span>
			{:else if phase === 'structuring'}
				<span>Sorting the ramble…</span>
			{:else if saving.length}
				<span>
					{saving.length === 1 ? '1 task' : `${saving.length} tasks`}{subtaskCount
						? `, ${subtaskCount === 1 ? '1 subtask' : `${subtaskCount} subtasks`}`
						: ''}
				</span>
			{/if}
		</div>
		<button
			type="button"
			class="mode hit-area relative justify-self-end"
			data-mode={mode}
			aria-label={mode === 'smart' ? 'Smart parsing. Switch to spoken commands' : 'Spoken commands. Switch to smart parsing'}
			title={mode === 'smart' ? 'Smart: Gemini reads the ramble' : 'Commands: only spoken cues structure it'}
			disabled={phase === 'structuring'}
			onclick={() => setMode(mode === 'smart' ? 'commands' : 'smart')}
		>
			{#key mode}
				<span class="flex items-center gap-1.5" in:pop>
					{#if mode === 'smart'}<Sparkle size={14} weight="fill" />Smart{:else}<Command size={14} weight="bold" />Commands{/if}
				</span>
			{/key}
		</button>
	</header>

	<div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto flex min-h-full w-full max-w-[600px] flex-col px-5 pt-4 pb-6">
			{#if !items.length && phase !== 'review'}
				<div class="m-auto max-w-sm text-center" out:fade={motion({ duration: 160 })}>
					{#key mode}
						<p class="text-[26px] leading-tight font-semibold tracking-[-0.02em]" in:arrive={{ y: 10 }}>
							{mode === 'smart' ? 'Just talk.' : 'Talk in cues.'}
						</p>
						<p class="mt-2 text-[15px] text-muted" in:arrive={{ delay: 80, y: 10 }}>
							{mode === 'smart'
								? 'Tasks, dates, lists, and corrections fall into place as you go.'
								: 'Only these words split and shape your tasks.'}
						</p>
						<ul class="mt-7 space-y-2.5 text-[14px] text-balance text-faint">
							{#each HINTS[mode] as hint, i (hint)}
								<li in:arrive={{ delay: 200 + i * 90, y: 8 }}>{mode === 'smart' ? `“${hint}”` : hint}</li>
							{/each}
						</ul>
					{/key}
				</div>
			{/if}

			<ul class="space-y-1" aria-label="Spoken tasks">
				{#each items as entry (entry.key)}
					<li animate:flip={motion({ duration: 280, easing: cubicOut })} in:arrive out:fade={motion({ duration: 160 })}>
						{@render task(entry)}
					</li>
				{/each}
			</ul>

			{#if notice}
				<p class="mt-4 text-center text-[13px] text-muted" in:fade={motion({ duration: 160 })}>{notice}</p>
			{/if}
		</div>
	</div>

	<footer class="mx-auto w-full max-w-[600px] px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
		{#if listening && transcript}
			<p class="caption mb-1 line-clamp-2 text-center text-[15px] leading-6 text-faint" transition:fade={motion({ duration: 160 })}>
				{#each captionParts as part, i (i)}{#if part.kind === 'command'}<span class="italic opacity-60">{part.text}</span>{:else if part.kind}<mark style={`--tint: var(--token-${part.kind})`}>{part.text}</mark>{:else}{part.text}{/if}{/each}
			</p>
		{/if}
		<div class="h-16">
			<Waveform {meter} active={phase === 'listening'} />
		</div>
		<div class="flex h-20 items-center justify-center gap-3">
			{#if phase === 'review'}
				<button
					type="button"
					class="talk grid size-14 shrink-0 place-items-center rounded-full text-accent"
					aria-label={items.length ? 'Keep talking' : 'Talk again'}
					onclick={start}
					in:scale={motion({ start: 0.7, duration: 260, easing: backOut })}
				>
					<Microphone size={22} weight="fill" />
				</button>
				{#if saving.length}
					<button
						type="button"
						class="btn btn-primary h-14 flex-1 text-[16px]"
						onclick={save}
						in:fly={motion({ x: 16, duration: 260, easing: cubicOut })}
					>
						{saving.length === 1 ? 'Add task' : `Add ${saving.length} tasks`}
					</button>
				{:else}
					<button type="button" class="btn btn-quiet h-14 flex-1 text-[16px]" onclick={typeInstead}>Type instead</button>
				{/if}
			{:else}
				<button
					type="button"
					class="stop grid size-16 place-items-center rounded-full bg-accent text-on-accent"
					aria-label="Stop listening"
					disabled={phase !== 'listening'}
					onclick={stop}
					in:scale={motion({ start: 0.7, duration: 260, easing: backOut })}
				>
					{#if phase !== 'listening'}
						<span class="spinner size-5 rounded-full border-2 border-current border-t-transparent"></span>
					{:else}
						<span class="size-5 rounded-[5px] bg-current"></span>
					{/if}
				</button>
			{/if}
		</div>
	</footer>
</div>

{#snippet task(entry: RambleEntry)}
	{@const editable = phase === 'review' && !live.includes(entry)}
	{@const expanded = editable && open === entry.key}
	<div class="row rounded-[18px] px-2 py-2" class:expanded>
		<div class="flex items-start gap-3">
			<span
				class="mt-[3px] size-[18px] shrink-0 rounded-full border-[1.5px] transition-colors duration-300"
				style:border-color={PRIORITIES[entry.priority ?? DEFAULT_PRIORITY].tone}
			></span>
			<div class="min-w-0 flex-1">
				{#if editable}
					<textarea
						rows="1"
						class="title block w-full resize-none [field-sizing:content] bg-transparent text-[17px] leading-6 font-semibold outline-none"
						aria-label="Task title"
						bind:value={entry.title}
						onfocus={() => (open = entry.key)}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								e.currentTarget.blur();
							}
						}}
					></textarea>
				{:else}
					<p class="text-[17px] leading-6 font-semibold [overflow-wrap:anywhere]">
						{#each entry.title.split(' ') as piece, i (i)}<span in:word>{piece}</span>{' '}{/each}
					</p>
				{/if}
				{#if expanded}
					{@const home = landing(entry)}
					<div class="mt-2 flex flex-wrap items-center gap-1.5" in:fade={motion({ duration: 160 })}>
						<DuePicker due={entry.due} onchange={(due) => (entry.due = due)} />
						<PriorityPicker priority={entry.priority ?? DEFAULT_PRIORITY} onchange={(priority) => (entry.priority = priority)} />
						<LabelPicker labelIds={entry.labelIds} labels={store.dataOf(home).labels} canCreate={home === null} onchange={(labelIds) => (entry.labelIds = labelIds)} />
						<ProjectPicker projectId={entry.projectId} projects={names.projects} sections={[]} onchange={(place) => (entry.projectId = place.projectId)} />
						{#if entry.recurrence}
							<button type="button" class="chip" data-active="true" style="color: var(--tone-repeat)" aria-label="Remove repeat" onclick={() => (entry.recurrence = null)}>
								<Repeat size={15} weight="bold" />{formatRecurrence(entry.recurrence, entry.due)}<X size={11} weight="bold" />
							</button>
						{/if}
						{#each entry.reminders as reminder, i (i)}
							<button
								type="button"
								class="chip"
								data-active="true"
								style="color: var(--tone-week)"
								aria-label="Remove reminder"
								onclick={() => (entry.reminders = entry.reminders.filter((_, at) => at !== i))}
							>
								<Bell size={15} weight="fill" />{formatReminder(reminder, clock.today)}<X size={11} weight="bold" />
							</button>
						{/each}
					</div>
				{:else}
					{@render chips(entry)}
				{/if}
				{#if entry.notes}
					<p class="mt-1 line-clamp-2 text-[13px] text-muted">{entry.notes}</p>
				{/if}
			</div>
			{#if editable}
				<button
					type="button"
					class="remove hit-area relative -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-faint -mt-1"
					aria-label={`Remove ${entry.title}`}
					onclick={() => remove(entry.key)}
				>
					<X size={14} weight="bold" />
				</button>
			{/if}
		</div>
		{#if entry.subtasks.length}
			{@render subtaskList(entry.subtasks, editable)}
		{/if}
	</div>
{/snippet}

{#snippet subtaskList(list: RambleEntry[], editable: boolean)}
	<ul class="mt-1 ml-[8px] border-l border-ink/10 pl-[19px]" aria-label="Subtasks">
		{#each list as subtask, i (subtask.key)}
			<li
				animate:flip={motion({ duration: 240, easing: cubicOut })}
				in:arrive={{ delay: i * 50, y: 8 }}
				out:fade={motion({ duration: 140 })}
			>
				<div class="flex items-start gap-2.5 py-1">
						<span class="mt-[4px] size-[14px] shrink-0 rounded-full border-[1.5px] border-ink/30"></span>
					<div class="min-w-0 flex-1">
						{#if editable}
							<textarea
								rows="1"
								class="title block w-full resize-none [field-sizing:content] bg-transparent text-[15px] leading-[22px] outline-none"
								aria-label="Subtask title"
								bind:value={subtask.title}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										e.currentTarget.blur();
									}
								}}
							></textarea>
						{:else}
							<p class="text-[15px] leading-[22px]">{subtask.title}</p>
						{/if}
						{@render chips(subtask)}
					</div>
					{#if editable}
						<button
							type="button"
							class="remove hit-area relative -mr-1 -my-0.5 grid size-7 shrink-0 place-items-center rounded-full text-faint"
							aria-label={`Remove ${subtask.title}`}
							onclick={() => remove(subtask.key)}
						>
							<X size={12} weight="bold" />
						</button>
					{/if}
				</div>
				{#if subtask.subtasks.length}
					{@render subtaskList(subtask.subtasks, editable)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet chips(entry: RambleEntry)}
	{@const project = store.project(entry.projectId)}
	{@const labels = store.labelsOf(entry)}
	{#if entry.due || entry.recurrence || entry.reminders.length || (entry.priority && entry.priority !== 4) || project || labels.length}
		<div class="mt-1.5 flex flex-wrap gap-1.5">
			{#if entry.due}
				{#key formatDue(entry.due, clock.today)}
					<span class="token" style={`color: var(--tone-${dueTone(entry.due, clock.today)})`} in:pop>
						<CalendarBlank size={13} weight="fill" />{formatDue(entry.due, clock.today)}
					</span>
				{/key}
			{/if}
			{#if entry.recurrence}
				<span class="token" style="color: var(--tone-repeat)" in:pop><Repeat size={13} weight="bold" />{formatRecurrence(entry.recurrence, entry.due)}</span>
			{/if}
			{#each entry.reminders as reminder, i (i)}
				<span class="token" style="color: var(--tone-week)" in:pop><Bell size={13} weight="fill" />{formatReminder(reminder, clock.today)}</span>
			{/each}
			{#if entry.priority && entry.priority !== 4}
				{#key entry.priority}
					<span class="token" style={`color: ${PRIORITIES[entry.priority].tone}`} in:pop><Flag size={13} weight="fill" />P{entry.priority}</span>
				{/key}
			{/if}
			{#if project}
				<span class="token" in:pop><ProjectGlyph {project} size={13} weight="bold" />{project.name}</span>
			{/if}
			{#each labels as label (label.id)}
				{@const Icon = labelIcon(label)}
				<span class="token" in:pop><Icon size={13} weight="fill" class="text-[var(--label-tone)]" style={labelStyle(label.color)} />{label.name}</span>
			{/each}
		</div>
	{/if}
{/snippet}

<style>
	/* iOS Safari overlays the keyboard on a fixed layer, so the drawer ends above it to keep its footer and the field in view. */
	.ramble {
		border-radius: 0;
		bottom: var(--keyboard-inset, 0px);
	}

	.row {
		transition: background 200ms var(--ease-spring);
	}

	.row.expanded {
		background: color-mix(in srgb, var(--color-ink) 4%, transparent);
	}

	.title::placeholder {
		color: var(--color-faint);
	}

	.token {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		height: 1.625rem;
		padding: 0 0.625rem 0 0.5rem;
		border-radius: 9999px;
		background: color-mix(in srgb, currentColor 10%, transparent);
		color: var(--color-ink);
		font-size: 0.8125rem;
		font-weight: 550;
		white-space: nowrap;
	}

	mark {
		background: var(--tint);
		color: var(--color-ink);
		border-radius: 0.3125rem;
		box-shadow: 0 0 0 2px var(--tint);
	}

	.caption {
		text-wrap: balance;
	}

	.stop {
		box-shadow:
			inset 0 1px 0 0 rgb(255 255 255 / 0.3),
			0 10px 28px -10px color-mix(in srgb, var(--color-accent) 75%, transparent);
		transition: scale 220ms var(--ease-spring);
	}

	.stop:active,
	.talk:active {
		scale: 0.92;
	}

	.talk {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 22%, transparent);
		transition: scale 220ms var(--ease-spring);
	}

	.mode {
		display: inline-flex;
		align-items: center;
		height: 2rem;
		padding: 0 0.75rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-muted);
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
		transition:
			color 200ms var(--ease-spring),
			background 200ms var(--ease-spring),
			scale 220ms var(--ease-spring);
	}

	.mode[data-mode='smart'] {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.mode:active {
		scale: 0.94;
	}

	.mode:disabled {
		opacity: 0.6;
	}

	.remove {
		transition: color 160ms var(--ease-spring), background 160ms var(--ease-spring);
	}

	@media (hover: hover) {
		.remove:hover {
			color: var(--color-ink);
			background: color-mix(in srgb, var(--color-ink) 7%, transparent);
		}
	}

	.pulse {
		animation: pulse 1.6s var(--ease-spring) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			scale: 1;
		}
		50% {
			opacity: 0.35;
			scale: 0.7;
		}
	}

	.spinner {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}
</style>
