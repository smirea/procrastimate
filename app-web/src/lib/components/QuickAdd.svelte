<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { untrack } from 'svelte';
	import Bell from 'phosphor-svelte/lib/Bell';
	import Microphone from 'phosphor-svelte/lib/Microphone';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Stop from 'phosphor-svelte/lib/Stop';
	import Tag from 'phosphor-svelte/lib/Tag';
	import { parseQuickAdd, type QuickAddToken, type TokenKind } from 'shared/quick-add.ts';
	import { parseRamble } from 'shared/ramble.ts';
	import { quickAddFromRamble, withListDefaults } from 'shared/ramble-fill.ts';
	import { unknownNames, type UnknownName } from 'shared/name-search.ts';
	import { DEFAULT_PRIORITY, type Due, type Priority, type Recurrence, type Reminder } from 'shared/task.ts';
	import SmartInput from './SmartInput.svelte';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import ProjectPicker from './ProjectPicker.svelte';
	import KeepAsText from './KeepAsText.svelte';
	import { store } from '../store.svelte.ts';
	import { clock, mobile, sheets, type QuickAddDefaults, motion } from '../ui.svelte.ts';
	import { formatRecurrence, formatReminder } from 'shared/format.ts';
	import { NAME_SOURCES } from '../names.ts';
	import { listenRamble, type RambleListen } from '../ramble/capture.ts';

	let { defaults }: { defaults: QuickAddDefaults } = $props();

	type Picked = {
		due: Due | null;
		priority: Priority | null;
		projectId: string | null;
		labelIds: string[];
		reminders: Reminder[];
	};
	const initialPicked = (): Picked => ({
		due: defaults.today ? { date: clock.today, time: null } : null,
		priority: null,
		projectId: defaults.projectId,
		labelIds: defaults.labelId ? [defaults.labelId] : [],
		reminders: [],
	});

	let text = $state('');
	let disabled = $state<string[]>([]);
	let picked = $state<Picked>(initialPicked());
	let spokenRecurrence = $state<Recurrence | null>(null);
	let listening = $state(false);
	let typed = $state(false);
	let notice = $state('');
	let input: SmartInput;
	let listAt = $state<number | null>(null);
	let session: RambleListen | null = null;
	let generation = 0;
	let transcript = '';
	let applyOnStop = true;
	let alive = true;

	const showMic = $derived(listening || !typed);

	const parsed = $derived(
		parseQuickAdd(text, { now: new Date(clock.now), projects: store.projects, labels: store.labels, disabled, due: picked.due }),
	);
	const tokenOf = (kind: TokenKind) => parsed.tokens.find((t) => t.kind === kind);
	const recurrence = $derived(parsed.recurrence ?? spokenRecurrence);
	const due = $derived(listening ? picked.due : (parsed.due ?? picked.due));
	const priority = $derived(listening ? (picked.priority ?? DEFAULT_PRIORITY) : (parsed.priority ?? picked.priority ?? DEFAULT_PRIORITY));
	const projectId = $derived(listening ? picked.projectId : (parsed.projectId ?? picked.projectId));
	const fieldTokens = $derived(listening ? [] : parsed.tokens);
	const reminderTokens = $derived(fieldTokens.filter((t) => t.kind === 'reminder'));
	const labelTokens = $derived(
		fieldTokens
			.filter((t) => t.kind === 'label')
			.map((token) => ({ token, name: store.labels.find((l) => `@${l.name}`.toLowerCase() === token.text.toLowerCase())?.name })),
	);
	const labelIds = $derived(listening ? picked.labelIds : [...new Set([...picked.labelIds, ...parsed.labelIds])]);
	/** Names to offer creating. The one the suggestion list is open on already offers it there. */
	const unknown = $derived(
		unknownNames(text, fieldTokens, store.projects, store.labels).filter((name) => name.start !== listAt),
	);

	function create(name: UnknownName) {
		NAME_SOURCES[name.sigil === '#' ? 'project' : 'label'].create(name.name);
		input.focus();
	}

	function keepAsText(token: QuickAddToken | undefined) {
		if (token) disabled = [...disabled, token.text];
		input.focus();
	}

	/** A manual pick replaces whatever the text said for that attribute. */
	function clearToken(kind: TokenKind) {
		const token = tokenOf(kind);
		if (token) text = (text.slice(0, token.start) + text.slice(token.end)).replaceAll(/\s{2,}/g, ' ');
		input.focus();
	}

	function submit() {
		if (!parsed.title || listening) return;
		const reminders = [...parsed.reminders, ...picked.reminders];
		store.addTask({ title: parsed.title, due, recurrence, priority, projectId, labelIds, reminders });
		text = '';
		disabled = [];
		picked = initialPicked();
		spokenRecurrence = null;
		typed = false;
		notice = '';
		input.focus();
	}

	function rambleOptions() {
		return { now: new Date(clock.now), projects: store.projects, labels: store.labels };
	}

	function applyTranscript() {
		const draft = parseRamble(transcript, rambleOptions());
		const fill = quickAddFromRamble(draft);
		if (!fill) return;
		const next = withListDefaults(fill, defaults, clock.today);
		text = next.text;
		disabled = [];
		picked = {
			due: next.due,
			priority: next.priority,
			projectId: next.projectId,
			labelIds: next.labelIds,
			reminders: next.reminders,
		};
		spokenRecurrence = next.recurrence;
	}

	function start() {
		const token = ++generation;
		session?.stop();
		transcript = '';
		notice = '';
		applyOnStop = true;
		listening = true;
		typed = false;
		const next = listenRamble({
			choice: store.dictation,
			online: navigator.onLine,
			onText: (spoken) => {
				if (token !== generation || !listening) return;
				transcript = spoken;
				text = spoken;
				if (parseRamble(spoken, rambleOptions()).ended) stop(true);
			},
			onStop: (reason, message) => {
				if (token !== generation || !alive) return;
				listening = false;
				session = null;
				if (reason === 'denied') notice = message ?? 'The microphone is off. You can type the ramble instead.';
				else if (reason === 'limit' || reason === 'unavailable') notice = message ?? 'Ramble needs a connection';
				else if (reason === 'error' || reason === 'unsupported') notice = 'Dictation stopped. You can type the task instead.';
				else notice = '';
				if (applyOnStop) applyTranscript();
			},
		});
		session = next;
		if (next.typed) {
			listening = false;
			session = null;
			notice = 'You can type the task instead.';
		}
	}

	function stop(apply = true) {
		applyOnStop = apply;
		const current = session;
		if (!current || current.typed) {
			listening = false;
			if (apply) applyTranscript();
			return;
		}
		current.stop();
	}

	function ontype() {
		if (listening) stop(false);
		typed = true;
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

	$effect(() => {
		if (!text) {
			disabled = [];
			typed = false;
		}
	});

	$effect(() => () => {
		alive = false;
		untrack(() => session?.stop());
	});

	const enter = (node: Element) =>
		mobile.current
			? fly(node, motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 }))
			: scale(node, motion({ start: 0.96, duration: 200, easing: cubicOut, opacity: 0 }));
</script>

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
				label="Task name"
				placeholder="Call mom tomorrow 5pm p1 remind me 30m before"
				autofocus
				enterkeyhint="send"
				reserve={showMic}
				class="text-[17px] font-medium"
				oninput={ontype}
				{onkeydown}
			/>
			{#if showMic}
				<button
					type="button"
					class="mic absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-accent text-on-accent transition-transform active:scale-90"
					aria-label={listening ? 'Stop listening' : 'Ramble'}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => (listening ? stop() : start())}
				>
					{#if listening}
						<Stop size={14} weight="fill" />
					{:else}
						<Microphone size={16} weight="fill" />
					{/if}
				</button>
			{/if}
		</div>
		{#if notice}
			<p class="pt-2 text-[13px] text-muted">{notice}</p>
		{/if}
	</div>
	<div class="flex items-start gap-1.5 px-4 pb-3">
	<div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
		<DuePicker {due} onchange={(value) => {
				clearToken('due');
				picked.due = value;
			}} onkeepastext={tokenOf('due') ? () => keepAsText(tokenOf('due')) : undefined} />
		{#if recurrence}
			<div class="flex items-center" transition:scale={motion({ start: 0.9, duration: 160 })}>
				<span class="chip" data-active="true" style="color: var(--tone-repeat)">
					<Repeat size={15} weight="bold" />
					{formatRecurrence(recurrence, due)}
				</span>
				{#if parsed.recurrence}
					<KeepAsText onclick={() => keepAsText(tokenOf('recurrence'))} />
				{/if}
			</div>
		{/if}
		<ReminderPicker {due} reminders={picked.reminders} onchange={(value) => (picked.reminders = value)} />
		{#each reminderTokens as token, i (token.text + token.start)}
			<div class="flex items-center" transition:scale={motion({ start: 0.9, duration: 160 })}>
				<span class="chip" data-active="true" style="color: var(--tone-week)">
					<Bell size={15} weight="fill" />
					{formatReminder(parsed.reminders[i]!, clock.today)}
				</span>
				<KeepAsText onclick={() => keepAsText(token)} />
			</div>
		{/each}
		{#each store.labelsOf({ labelIds: picked.labelIds.filter((id) => !parsed.labelIds.includes(id)) }) as label (label.id)}
			<span class="chip" data-active="true" transition:scale={motion({ start: 0.9, duration: 160 })}>
				<Tag size={15} weight="fill" class="text-[var(--tone-label)]" />
				{label.name}
			</span>
		{/each}
		{#each labelTokens as { token, name } (token.start)}
			<div class="flex items-center" transition:scale={motion({ start: 0.9, duration: 160 })}>
				<span class="chip" data-active="true">
					<Tag size={15} weight="fill" class="text-[var(--tone-label)]" />
					{name}
				</span>
				<KeepAsText onclick={() => keepAsText(token)} />
			</div>
		{/each}
		{#each unknown as name (name.sigil + name.name.toLowerCase())}
			<button
				type="button"
				class="chip text-accent"
				transition:scale={motion({ start: 0.9, duration: 160 })}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => create(name)}
			>
				<Plus size={15} weight="bold" />
				Create {name.sigil}{name.name}
			</button>
		{/each}
	</div>
	<PriorityPicker iconOnly {priority} onchange={(value) => {
			clearToken('priority');
			picked.priority = value;
		}} onkeepastext={tokenOf('priority') ? () => keepAsText(tokenOf('priority')) : undefined} />
	</div>
	<div class="flex items-center justify-between gap-2 border-t border-ink/5 px-3 py-2.5">
		<ProjectPicker {projectId} onchange={(value) => {
				clearToken('project');
				picked.projectId = value;
			}} onkeepastext={tokenOf('project') ? () => keepAsText(tokenOf('project')) : undefined} />
		<div class="flex gap-1.5">
			<button type="button" class="btn btn-quiet" onclick={() => sheets.close()}>Cancel</button>
			<button type="button" class="btn btn-primary" disabled={listening || !parsed.title} onclick={submit}>Add task</button>
		</div>
	</div>
</div>

<style>
	.mic {
		box-shadow:
			inset 0 1px 0 0 rgb(255 255 255 / 0.3),
			0 6px 16px -6px color-mix(in srgb, var(--color-accent) 60%, transparent);
	}
</style>
