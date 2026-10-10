<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Bell from 'phosphor-svelte/lib/Bell';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import { parseQuickAdd, type QuickAddToken, type TokenKind } from 'shared/quick-add.ts';
	import { DEFAULT_PRIORITY, type Due, type Priority, type Reminder } from 'shared/task.ts';
	import SmartInput from './SmartInput.svelte';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import ProjectPicker from './ProjectPicker.svelte';
	import KeepAsText from './KeepAsText.svelte';
	import { store } from '../store.svelte.ts';
	import { clock, mobile, sheets, type QuickAddDefaults } from '../ui.svelte.ts';
	import { formatRecurrence, formatReminder } from '../format.ts';
	import { requestNotificationPermission } from '../reminders.ts';

	let { defaults }: { defaults: QuickAddDefaults } = $props();

	type Picked = { due: Due | null; priority: Priority | null; projectId: string | null; reminders: Reminder[] };
	const initialPicked = (): Picked => ({
		due: defaults.today ? { date: clock.today, time: null } : null,
		priority: null,
		projectId: defaults.projectId,
		reminders: [],
	});

	let text = $state('');
	let disabled = $state<string[]>([]);
	let picked = $state<Picked>(initialPicked());
	let input: SmartInput;

	const parsed = $derived(parseQuickAdd(text, { now: new Date(clock.now), projects: store.projects, disabled, due: picked.due }));
	const tokenOf = (kind: TokenKind) => parsed.tokens.find((t) => t.kind === kind);
	const due = $derived(parsed.due ?? picked.due);
	const priority = $derived(parsed.priority ?? picked.priority ?? DEFAULT_PRIORITY);
	const projectId = $derived(parsed.projectId ?? picked.projectId);
	const reminderTokens = $derived(parsed.tokens.filter((t) => t.kind === 'reminder'));

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
		if (!parsed.title) return;
		const reminders = [...parsed.reminders, ...picked.reminders];
		store.addTask({ title: parsed.title, due, recurrence: parsed.recurrence, priority, projectId, reminders });
		requestNotificationPermission(reminders);
		text = '';
		disabled = [];
		picked = initialPicked();
		input.focus();
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
		if (!text) disabled = [];
	});

	const enter = (node: Element) =>
		mobile.current
			? fly(node, { y: '100%', duration: 300, easing: cubicOut, opacity: 1 })
			: scale(node, { start: 0.96, duration: 200, easing: cubicOut, opacity: 0 });
</script>

<div class="fixed inset-0 z-40 bg-zinc-900/10 backdrop-blur-[2px]" transition:fade={{ duration: 160 }} onclick={() => sheets.close()} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Quick add"
	class="glass-strong sheet fixed z-50 flex flex-col md:top-[14vh] md:left-1/2 md:w-[min(640px,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-2xl"
	transition:enter
>
	<div class="px-4 pt-4 pb-2">
		<SmartInput
			bind:this={input}
			bind:value={text}
			tokens={parsed.tokens}
			label="Task name"
			placeholder="Call mom tomorrow 5pm p1 remind me 30m before"
			autofocus
			enterkeyhint="send"
			class="text-[17px] font-medium"
			{onkeydown}
		/>
	</div>
	<div class="flex flex-wrap items-center gap-1.5 px-4 pb-3">
		<DuePicker {due} onchange={(value) => {
				clearToken('due');
				picked.due = value;
			}} onkeepastext={tokenOf('due') ? () => keepAsText(tokenOf('due')) : undefined} />
		<PriorityPicker {priority} onchange={(value) => {
				clearToken('priority');
				picked.priority = value;
			}} onkeepastext={tokenOf('priority') ? () => keepAsText(tokenOf('priority')) : undefined} />
		{#if parsed.recurrence}
			<div class="flex items-center" transition:scale={{ start: 0.9, duration: 160 }}>
				<span class="chip" data-active="true" style="color: var(--tone-tomorrow)">
					<Repeat size={15} weight="bold" />
					{formatRecurrence(parsed.recurrence, due)}
				</span>
				<KeepAsText onclick={() => keepAsText(tokenOf('recurrence'))} />
			</div>
		{/if}
		<ReminderPicker {due} reminders={picked.reminders} onchange={(value) => (picked.reminders = value)} />
		{#each reminderTokens as token, i (token.text + token.start)}
			<div class="flex items-center" transition:scale={{ start: 0.9, duration: 160 }}>
				<span class="chip" data-active="true" style="color: var(--tone-week)">
					<Bell size={15} weight="fill" />
					{formatReminder(parsed.reminders[i]!, clock.today)}
				</span>
				<KeepAsText onclick={() => keepAsText(token)} />
			</div>
		{/each}
	</div>
	<div class="flex items-center justify-between gap-2 border-t border-black/5 px-3 py-2.5">
		<ProjectPicker {projectId} onchange={(value) => {
				clearToken('project');
				picked.projectId = value;
			}} onkeepastext={tokenOf('project') ? () => keepAsText(tokenOf('project')) : undefined} />
		<div class="flex gap-1.5">
			<button type="button" class="btn btn-quiet" onclick={() => sheets.close()}>Cancel</button>
			<button type="button" class="btn btn-primary" disabled={!parsed.title} onclick={submit}>Add task</button>
		</div>
	</div>
</div>
