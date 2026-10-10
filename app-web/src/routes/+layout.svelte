<script lang="ts">
	import '../index.css';
	import { untrack, type Snippet } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { page } from '$app/state';
	import List from 'phosphor-svelte/lib/List';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import QuickAdd from '#lib/components/QuickAdd.svelte';
	import TaskDetails from '#lib/components/TaskDetails.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, sheets } from '#lib/ui.svelte.ts';
	import { fireDueReminders } from '#lib/reminders.ts';

	let { children }: { children: Snippet } = $props();
	let menuOpen = $state(false);

	const openTask = $derived(sheets.current.kind === 'task' ? store.task(sheets.current.id) : undefined);

	function openQuickAdd() {
		menuOpen = false;
		sheets.openQuickAdd({
			projectId: page.route.id === '/projects/[id]' ? (page.params.id ?? null) : null,
			today: page.route.id === '/today',
		});
	}

	const isTyping = (target: EventTarget | null) =>
		target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

	function onkeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
		if (event.key === 'q' && sheets.current.kind === 'none') {
			event.preventDefault();
			openQuickAdd();
		} else if (event.key === 'Escape' && sheets.current.kind !== 'none') {
			sheets.close();
		}
	}

	$effect(() => clock.start());

	$effect(() => {
		const now = clock.now;
		untrack(() => fireDueReminders(now));
	});

	$effect(() => {
		void page.url.pathname;
		menuOpen = false;
	});
</script>

<svelte:window {onkeydown} />

<div class="flex min-h-screen gap-3 p-3">
	<div class="sticky top-3 hidden h-[calc(100vh-1.5rem)] w-64 shrink-0 md:block">
		<Sidebar onquickadd={openQuickAdd} />
	</div>
	{#if menuOpen}
		<div class="fixed inset-y-3 left-3 z-30 w-64 md:hidden" transition:fly={{ x: -24, duration: 220, easing: cubicOut, opacity: 0 }}>
			<Sidebar onquickadd={openQuickAdd} />
		</div>
	{/if}
	<main class="min-w-0 flex-1">
		<button type="button" class="glass mb-3 grid size-10 place-items-center rounded-xl md:hidden" aria-label="Menu" onclick={() => (menuOpen = !menuOpen)}>
			<List size={18} />
		</button>
		<div class="mx-auto max-w-3xl px-2 pt-6 pb-24 md:px-8 md:pt-10">
			{@render children()}
		</div>
	</main>
</div>

{#if sheets.current.kind === 'quick-add'}
	<QuickAdd defaults={sheets.current.defaults} />
{:else if openTask}
	{#key openTask.id}
		<TaskDetails task={openTask} />
	{/key}
{/if}

<Toasts />
