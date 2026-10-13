<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { untrack } from 'svelte';
	import Bell from 'phosphor-svelte/lib/Bell';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import Flag from 'phosphor-svelte/lib/Flag';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Microphone from 'phosphor-svelte/lib/Microphone';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Tag from 'phosphor-svelte/lib/Tag';
	import X from 'phosphor-svelte/lib/X';
	import { parseRamble, type RambleToken } from 'shared/ramble.ts';
	import { formatDue, formatRecurrence, formatReminder, priorityLabel } from 'shared/format.ts';
	import { listenRamble, type RambleListen } from '../ramble/capture.ts';
	import { reconcileCards, saveOf, taskCountLabel, transcriptPieces, type RambleCard } from '../ramble/cards.ts';
	import { store } from '../store.svelte.ts';
	import { clock, mobile, motion, sheets, toasts, type QuickAddDefaults } from '../ui.svelte.ts';
	import DuePicker from './DuePicker.svelte';

	let { defaults, listen }: { defaults: QuickAddDefaults; listen: boolean } = $props();

	let committed = $state('');
	let partialStart = $state(0);
	let cards = $state<RambleCard[]>([]);
	let hidden = $state<number[]>([]);
	let tokens = $state<RambleToken[]>([]);
	let listening = $state(false);
	let typed = $state(false);
	let notice = $state<string | null>(null);
	let level = $state(0);
	let editing = $state<string | null>(null);
	let undo = $state<RambleCard | null>(null);
	let confirming = $state(false);
	let session: RambleListen | null = null;
	let undoTimer = 0;
	let generation = 0;

	const draft = $derived(
		parseRamble(committed, { now: new Date(clock.now), projects: store.projects, labels: store.labels }),
	);
	const pieces = $derived(transcriptPieces(committed, tokens));
	const count = $derived(cards.filter(card => card.title.trim()).length);
	const tint: Partial<Record<RambleToken['kind'], string>> = {
		due: 'var(--token-due)',
		priority: 'var(--token-priority)',
		reminder: 'var(--token-reminder)',
		project: 'var(--token-project)',
		recurrence: 'var(--token-recurrence)',
		label: 'var(--token-label)',
	};

	$effect(() => {
		const next = draft;
		const today = clock.today;
		if (next.ended) untrack(stop);
		tokens = next.tokens;
		cards = reconcileCards(untrack(() => cards), next.tasks, new Set(untrack(() => hidden)), defaults, today, () => crypto.randomUUID());
	});

	function start() {
		const token = ++generation;
		notice = null;
		session?.stop();
		listening = true;
		typed = false;
		const prefix = committed.trim();
		sheets.rambleRelease = stop;
		session = listenRamble({
			choice: store.dictation,
			online: navigator.onLine,
			onText: (text, startAt) => {
				if (token !== generation) return;
				if (!prefix) {
					committed = text;
					partialStart = startAt;
					return;
				}
				const gap = prefix.endsWith(' ') ? '' : ' ';
				committed = prefix + gap + text;
				partialStart = prefix.length + gap.length + startAt;
			},
			onLevel: value => {
				if (token === generation) level = value;
			},
			onStop: (reason, message) => {
				if (token !== generation) return;
				listening = false;
				level = 0;
				if (sheets.rambleRelease === stop) sheets.rambleRelease = null;
				if (reason === 'denied' || reason === 'unsupported') typed = true;
				if (message && (reason === 'unavailable' || reason === 'limit' || reason === 'denied')) notice = message;
				else if (reason === 'unavailable') notice = 'Ramble needs a connection';
				else if (reason === 'limit') notice = "Ramble's daily limit is used up";
			},
		});
		if (session.typed) {
			listening = false;
			typed = true;
			sheets.rambleRelease = null;
		}
	}

	function stop() {
		session?.stop();
		session = null;
		listening = false;
		level = 0;
		if (sheets.rambleRelease === stop) sheets.rambleRelease = null;
	}

	function patch(id: string, partial: Partial<RambleCard>) {
		cards = cards.map(card => (card.id === id ? { ...card, ...partial, pinned: true } : card));
	}

	function discard(card: RambleCard) {
		hidden = [...hidden, card.anchor];
		cards = cards.filter(item => item.id !== card.id);
		undo = card;
		if (editing === card.id) editing = null;
		clearTimeout(undoTimer);
		undoTimer = window.setTimeout(() => {
			if (undo?.id === card.id) undo = null;
		}, 4000);
	}

	function restore() {
		if (!undo) return;
		const card = undo;
		undo = null;
		hidden = hidden.filter(anchor => anchor !== card.anchor);
		cards = reconcileCards([card, ...cards], draft.tasks, new Set(hidden), defaults, clock.today, () => crypto.randomUUID());
	}

	function save() {
		const tasks = cards.filter(card => card.title.trim()).map(saveOf);
		if (!tasks.length) return;
		stop();
		const ids = store.addRamble(tasks);
		sheets.close();
		toasts.show(taskCountLabel(tasks.length, 'Added'), {
			label: 'Undo',
			run: () => store.deleteTasks(ids),
		});
	}

	function cancel() {
		if (!cards.length) {
			stop();
			sheets.close();
			return;
		}
		confirming = true;
	}

	function confirmCancel() {
		stop();
		sheets.close();
	}

	let holdTimer = 0;
	let holding = false;
	let swallowClick = false;

	function pointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		holding = false;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		holdTimer = window.setTimeout(() => {
			holding = true;
			if (!listening) start();
		}, 220);
	}

	function pointerup() {
		clearTimeout(holdTimer);
		if (!holding) return;
		holding = false;
		swallowClick = true;
		stop();
	}

	function pieceMuted(index: number) {
		let at = 0;
		for (let i = 0; i < index; i++) at += pieces[i]?.text.length ?? 0;
		return at >= partialStart && partialStart < committed.length;
	}

	function micClick() {
		if (swallowClick) {
			swallowClick = false;
			return;
		}
		if (listening) stop();
		else start();
	}

	$effect(() => {
		if (listen) untrack(start);
		return () => untrack(stop);
	});

	const enter = (node: Element) =>
		mobile.current
			? fly(node, motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 }))
			: scale(node, motion({ start: 0.96, duration: 200, easing: cubicOut, opacity: 0 }));
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={cancel} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Ramble"
	class="glass-strong sheet fixed z-50 flex max-h-[min(720px,80dvh)] flex-col md:top-[10vh] md:left-1/2 md:w-[min(640px,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-panel"
	transition:enter
>
	<div class="flex items-center justify-between px-4 pt-4 pb-2">
		<h2 class="text-[15px] font-semibold">Ramble</h2>
		{#if confirming}
			<div class="flex items-center gap-1.5">
				<span class="text-[13px] text-muted">Discard this ramble?</span>
				<button type="button" class="btn btn-quiet" onclick={() => (confirming = false)}>Keep</button>
				<button type="button" class="btn btn-quiet" onclick={confirmCancel}>Discard</button>
			</div>
		{:else}
			<button type="button" class="btn btn-quiet" onclick={cancel}>Cancel</button>
		{/if}
	</div>
	<div
		class="mx-4 max-h-[4.5em] overflow-y-auto rounded-2xl bg-ink/5 px-3 py-2 text-[15px] leading-snug"
		aria-label="Live transcript"
		aria-live="polite"
	>
		{#if typed}
			<textarea
				class="field min-h-16 w-full resize-none bg-transparent outline-none"
				aria-label="Live transcript"
				placeholder="Type a ramble"
				value={committed}
				oninput={event => {
					committed = event.currentTarget.value;
					partialStart = committed.length;
				}}
			></textarea>
		{:else if committed}
			<p>
				{#each pieces as piece, index (index)}
					<span class="rounded-sm" class:text-muted={pieceMuted(index)} style:background={piece.kind ? tint[piece.kind] : undefined}>{piece.text}</span>
				{/each}
			</p>
		{:else}
			<p class="text-muted">Hold the mic, or tap it, and talk.</p>
		{/if}
	</div>
	{#if notice}
		<p class="px-4 pt-2 text-[13px] text-muted">{notice}</p>
	{/if}
	<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
		{#if undo}
			<button type="button" class="btn btn-quiet self-start" onclick={restore}>Undo</button>
		{/if}
		{#each cards as card (card.id)}
			<article class="rounded-2xl bg-ink/5 px-3 py-2" aria-label="Edit task">
				<div class="flex items-start gap-2">
					{#if editing === card.id}
						<div class="min-w-0 flex-1">
							<input
								class="field w-full bg-transparent font-medium outline-none"
								aria-label="Edit task"
								value={card.title}
								oninput={event => patch(card.id, { title: event.currentTarget.value })}
							/>
							<textarea
								class="field mt-1 w-full resize-none bg-transparent text-[13px] text-muted outline-none"
								aria-label="Notes"
								placeholder="Notes"
								value={card.notes}
								oninput={event => patch(card.id, { notes: event.currentTarget.value })}
							></textarea>
						</div>
					{:else}
						<button type="button" class="min-w-0 flex-1 text-left" aria-label="Edit task" onclick={() => (editing = card.id)}>
							<p class="font-medium">{card.title}</p>
							{#if card.notes}
								<p class="truncate text-[13px] text-muted">{card.notes}</p>
							{/if}
						</button>
					{/if}
					<button type="button" class="grid size-9 shrink-0 place-items-center rounded-full text-muted" aria-label="Discard task" onclick={() => discard(card)}>
						<X size={14} weight="bold" />
					</button>
				</div>
				<div class="mt-2 flex flex-wrap items-center gap-1.5">
					{#if editing === card.id}
						<DuePicker due={card.due} onchange={due => patch(card.id, { due })} />
					{:else if card.due}
						<span class="chip" data-active="true" style="color: var(--tone-today)">
							<CalendarBlank size={15} weight="fill" />
							{formatDue(card.due, clock.today)}
						</span>
					{/if}
					{#if card.projectId && store.project(card.projectId)}
						<span class="chip" data-active="true">
							<Hash size={15} weight="bold" />
							{store.project(card.projectId)?.name}
						</span>
					{/if}
					{#each store.labelsOf(card) as label (label.id)}
						<span class="chip" data-active="true">
							<Tag size={15} weight="fill" class="text-[var(--tone-label)]" />
							{label.name}
						</span>
					{/each}
					{#if card.recurrence}
						<span class="chip" data-active="true" style="color: var(--tone-tomorrow)">
							<Repeat size={15} weight="bold" />
							{formatRecurrence(card.recurrence, card.due)}
						</span>
					{/if}
					{#if card.priority}
						<span class="chip" data-active="true" style="color: var(--tone-overdue)">
							<Flag size={15} weight="fill" />
							{priorityLabel(card.priority)}
						</span>
					{/if}
					{#each card.reminders as reminder, index (index)}
						<span class="chip" data-active="true" style="color: var(--tone-week)">
							<Bell size={15} weight="fill" />
							{formatReminder(reminder, clock.today)}
						</span>
					{/each}
				</div>
				{#if card.subtasks.length}
					<ul class="mt-2 border-l border-ink/10 pl-3">
						{#each card.subtasks as sub (sub.segment.start)}
							<li class="py-0.5 text-[14px]">
								{sub.title}
								{#if sub.notes}<span class="text-muted"> — {sub.notes}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</article>
		{/each}
	</div>
	<div class="flex items-center justify-between gap-3 border-t border-ink/5 px-4 py-3">
		<button
			type="button"
			class="mic grid size-14 place-items-center rounded-full bg-accent text-on-accent"
			style:box-shadow={listening ? `0 0 0 ${Math.round(3 + level * 10)}px color-mix(in srgb, var(--color-accent) 35%, transparent)` : undefined}
			aria-label={listening ? 'Stop listening' : committed ? 'Resume' : 'Ramble'}
			aria-pressed={listening}
			onpointerdown={pointerdown}
			onpointerup={pointerup}
			onpointercancel={pointerup}
			onclick={micClick}
		>
			<Microphone size={24} weight="fill" />
		</button>
		<button type="button" class="btn btn-primary" disabled={count === 0} onclick={save}>{taskCountLabel(count, 'Add')}</button>
	</div>
</div>

<style>
	.mic {
		touch-action: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.mic {
			box-shadow: none !important;
		}
	}
</style>
