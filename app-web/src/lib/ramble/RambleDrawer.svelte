<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { backOut, cubicOut } from 'svelte/easing';
	import { onMount, tick } from 'svelte';
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import Flag from 'phosphor-svelte/lib/Flag';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Microphone from 'phosphor-svelte/lib/Microphone';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Tag from 'phosphor-svelte/lib/Tag';
	import X from 'phosphor-svelte/lib/X';
	import { parseRamble, type RambleToken } from 'shared/ramble.ts';
	import { rambleNewTask } from 'shared/ramble-fill.ts';
	import { DEFAULT_PRIORITY } from 'shared/task.ts';
	import { dueTone, formatDue, formatRecurrence, formatReminder } from 'shared/format.ts';
	import DuePicker from '../components/DuePicker.svelte';
	import PriorityPicker from '../components/PriorityPicker.svelte';
	import ProjectPicker from '../components/ProjectPicker.svelte';
	import LabelPicker from '../components/LabelPicker.svelte';
	import { store } from '../store.svelte.ts';
	import { clock, mobile, motion, sheets, toasts, type QuickAddDefaults } from '../ui.svelte.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { showAdded } from '../show-added.ts';
	import { listenRamble, type CaptureStop, type RambleListen } from './capture.ts';
	import { caption, keyed, type RambleEntry } from './entries.ts';
	import Waveform, { type LevelMeter } from './Waveform.svelte';

	let { defaults }: { defaults: QuickAddDefaults } = $props();

	/** One capture at a time. `review` holds the reviewed list, and talking again appends to it. */
	type Phase = 'listening' | 'finishing' | 'review';

	const HINTS = [
		'Call mom tomorrow at 5pm, priority one',
		'Plan the trip, the steps are book flights and find a hotel',
		'Pay rent on Friday. Next task, water the plants',
	];

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
	let generation = 0;
	let nextKey = 0;
	const meter: LevelMeter = { level: 0 };

	const items = $derived([...entries, ...live]);
	const saving = $derived(entries.filter((entry) => entry.title.trim()));
	const subtaskCount = $derived(saving.reduce((sum, entry) => sum + entry.subtasks.length, 0));
	const captionParts = $derived(caption(transcript, tokens));
	const listening = $derived(phase !== 'review');

	const options = () => ({ now: new Date(clock.now), projects: store.projects, labels: store.labels });

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
		const began = performance.now();
		let ended = false;
		const timer = setInterval(() => (elapsed = Math.floor((performance.now() - began) / 1000)), 250);
		const next = listenRamble({
			choice: store.dictation,
			online: navigator.onLine,
			onLevel: (level) => (meter.level = level),
			onText: (spoken) => {
				if (token !== generation || phase === 'review') return;
				const draft = parseRamble(spoken, options());
				transcript = spoken;
				tokens = draft.tokens;
				void follow(() => (live = keyed(draft.tasks, nextKey)));
				if (draft.ended) stop();
			},
			onStop: (reason, message) => {
				clearInterval(timer);
				ended = true;
				if (token !== generation) return;
				session = null;
				notice = reason === 'stopped' ? '' : (message ?? NOTICES[reason] ?? '');
				settle();
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
	function settle() {
		const settled = keyed(parseRamble(transcript, options()).tasks, nextKey);
		nextKey += settled.length;
		live = [];
		entries.push(...settled);
		phase = 'review';
		meter.level = 0;
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
		entries = entries
			.filter((entry) => entry.key !== key)
			.map((entry) => ({ ...entry, subtasks: entry.subtasks.filter((subtask) => subtask.key !== key) }));
		if (open === key) open = null;
	}

	function save() {
		if (listening || !saving.length) return;
		const added = saving.flatMap((entry) => {
			const task = store.addTask(rambleNewTask(entry, defaults, clock.today));
			if (!task) return [];
			if (entry.notes) store.updateTask(task.id, { notes: entry.notes });
			for (const subtask of entry.subtasks) {
				if (!subtask.title.trim()) continue;
				const child = store.addTask(rambleNewTask(subtask, null, clock.today), task.id);
				if (child && subtask.notes) store.updateTask(child.id, { notes: subtask.notes });
			}
			return [task];
		});
		sheets.close();
		if (added[0]) showAdded(added[0]);
		if (added.length > 1) toasts.show(`Added ${added.length} tasks`);
	}

	function close() {
		generation++;
		session?.stop();
		sheets.close();
	}

	function typeInstead() {
		generation++;
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
			session?.stop();
		};
	});

	const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

	/** A textarea that grows with its title instead of scrolling. */
	const autosize = (node: HTMLTextAreaElement) => {
		const fit = () => {
			node.style.height = '0';
			node.style.height = `${node.scrollHeight}px`;
		};
		fit();
		node.addEventListener('input', fit);
		return { destroy: () => node.removeEventListener('input', fit) };
	};

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
	<header class="mx-auto flex w-full max-w-[600px] items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
		<button type="button" class="icon-btn" aria-label="Close" onclick={close}>
			<X size={18} weight="bold" />
		</button>
		<div class="flex flex-1 items-center justify-center gap-2 text-[13px] font-medium text-muted tabular-nums" aria-live="polite">
			{#if phase === 'listening'}
				<span class="pulse size-2 rounded-full bg-accent"></span>
				<span>Listening</span>
				<span class="text-faint">{clockText(elapsed)}</span>
			{:else if phase === 'finishing'}
				<span>Catching the last words…</span>
			{:else if saving.length}
				<span>
					{saving.length === 1 ? '1 task' : `${saving.length} tasks`}{subtaskCount
						? `, ${subtaskCount === 1 ? '1 subtask' : `${subtaskCount} subtasks`}`
						: ''}
				</span>
			{/if}
		</div>
		<span class="size-9 touch:size-11" aria-hidden="true"></span>
	</header>

	<div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto flex min-h-full w-full max-w-[600px] flex-col px-5 pt-4 pb-6">
			{#if !items.length && phase !== 'review'}
				<div class="m-auto max-w-sm text-center" out:fade={motion({ duration: 160 })}>
					<p class="text-[26px] leading-tight font-semibold tracking-[-0.02em]" in:arrive={{ y: 10 }}>Just talk.</p>
					<p class="mt-2 text-[15px] text-muted" in:arrive={{ delay: 80, y: 10 }}>Tasks, dates, and lists fall into place as you go.</p>
					<ul class="mt-7 space-y-2.5 text-[14px] text-balance text-faint">
						{#each HINTS as hint, i (hint)}
							<li in:arrive={{ delay: 200 + i * 90, y: 8 }}>“{hint}”</li>
						{/each}
					</ul>
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
					disabled={phase === 'finishing'}
					onclick={stop}
					in:scale={motion({ start: 0.7, duration: 260, easing: backOut })}
				>
					{#if phase === 'finishing'}
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
						use:autosize
						rows="1"
						class="title block w-full resize-none bg-transparent text-[17px] leading-6 font-semibold outline-none"
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
					<div class="mt-2 flex flex-wrap items-center gap-1.5" in:fade={motion({ duration: 160 })}>
						<DuePicker due={entry.due} onchange={(due) => (entry.due = due)} />
						<PriorityPicker priority={entry.priority ?? DEFAULT_PRIORITY} onchange={(priority) => (entry.priority = priority)} />
						<LabelPicker labelIds={entry.labelIds} onchange={(labelIds) => (entry.labelIds = labelIds)} />
						<ProjectPicker projectId={entry.projectId} onchange={(projectId) => (entry.projectId = projectId)} />
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
			<ul class="mt-1 ml-[8px] border-l border-ink/10 pl-[19px]" aria-label="Subtasks">
				{#each entry.subtasks as subtask, i (subtask.key)}
					<li
						class="flex items-start gap-2.5 py-1"
						animate:flip={motion({ duration: 240, easing: cubicOut })}
						in:arrive={{ delay: i * 50, y: 8 }}
						out:fade={motion({ duration: 140 })}
					>
						<span class="mt-[4px] size-[14px] shrink-0 rounded-full border-[1.5px] border-ink/30"></span>
						<div class="min-w-0 flex-1">
							{#if editable}
								<textarea
									use:autosize
									rows="1"
									class="title block w-full resize-none bg-transparent text-[15px] leading-[22px] outline-none"
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
					</li>
				{/each}
			</ul>
		{/if}
	</div>
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
				<span class="token" in:pop><Hash size={13} weight="bold" />{project.name}</span>
			{/if}
			{#each labels as label (label.id)}
				<span class="token" in:pop><Tag size={13} weight="fill" class="text-[var(--tone-label)]" />{label.name}</span>
			{/each}
		</div>
	{/if}
{/snippet}

<style>
	.ramble {
		border-radius: 0;
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
