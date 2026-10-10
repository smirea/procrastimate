<script lang="ts">
	import '../index.css';
	import { untrack, type Snippet } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { page } from '$app/state';
	import List from 'phosphor-svelte/lib/List';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import QuickAdd from '#lib/components/QuickAdd.svelte';
	import Search from '#lib/components/Search.svelte';
	import TaskSheet from '#lib/components/TaskSheet.svelte';
	import NotificationsSheet from '#lib/components/NotificationsSheet.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock, sheets, trackKeyboardInset } from '#lib/ui.svelte.ts';
	import { fireDueReminders } from '#lib/reminders.ts';
	import { openTaskFromUrl, push } from '#lib/push.svelte.ts';
	import { applyTheme, theme } from '#lib/theme.svelte.ts';

	let { children }: { children: Snippet } = $props();
	let menuOpen = $state(false);

	const openTask = $derived(sheets.current.kind === 'task' ? store.task(sheets.current.id) : undefined);

	function openQuickAdd() {
		menuOpen = false;
		sheets.openQuickAdd({
			projectId: page.route.id === '/projects/[id]' ? (page.params.id ?? null) : null,
			labelId: page.route.id === '/labels/[id]' ? (page.params.id ?? null) : null,
			today: page.route.id === '/today',
		});
	}

	function openSearch() {
		menuOpen = false;
		sheets.openSearch();
	}

	function openNotifications() {
		menuOpen = false;
		sheets.openNotifications();
	}

	const isTyping = (target: EventTarget | null) =>
		target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

	/** Some layouts need Shift for `/`, so only Cmd-K and Ctrl-K check the other modifiers. */
	const isSearchShortcut = (event: KeyboardEvent) =>
		event.metaKey || event.ctrlKey
			? !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k'
			: event.key === '/';

	function onkeydown(event: KeyboardEvent) {
		if (isTyping(event.target)) return;
		if (isSearchShortcut(event) && sheets.current.kind !== 'search') {
			event.preventDefault();
			openSearch();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'q' && sheets.current.kind === 'none') {
			event.preventDefault();
			openQuickAdd();
		} else if (event.key === 'Escape' && sheets.current.kind !== 'none') {
			sheets.close();
		} else if (event.key === 'Escape' && menuOpen) {
			menuOpen = false;
		}
	}

	$effect(() => applyTheme(theme.resolved));
	$effect(() => clock.start());
	$effect(() => trackKeyboardInset());
	$effect(() => push.start());
	$effect(() => push.sync());
	$effect(() => untrack(openTaskFromUrl));

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

<div class="app flex min-h-dvh gap-3">
	<div class="sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-64 shrink-0 md:block">
		<Sidebar onquickadd={openQuickAdd} onsearch={openSearch} onnotifications={openNotifications} />
	</div>
	{#if menuOpen}
		<div class="fixed inset-0 z-30 bg-scrim backdrop-blur-[2px] md:hidden" transition:fade={{ duration: 180 }} onclick={() => (menuOpen = false)} aria-hidden="true"></div>
		<div class="drawer fixed z-30 md:hidden" transition:fly={{ x: -320, duration: 280, easing: cubicOut, opacity: 1 }}>
			<Sidebar onquickadd={openQuickAdd} onsearch={openSearch} onnotifications={openNotifications} />
		</div>
	{/if}
	<main class="min-w-0 flex-1">
		<header class="scroll-edge sticky top-0 z-20 flex items-center md:hidden">
			<button
				type="button"
				class="glass grid size-11 place-items-center rounded-full"
				aria-label="Open navigation"
				aria-expanded={menuOpen}
				onclick={() => (menuOpen = true)}
			>
				<List size={20} />
			</button>
		</header>
		<div class="mx-auto max-w-3xl px-1 pt-2 pb-28 md:px-8 md:pt-10 md:pb-24">
			{@render children()}
		</div>
	</main>
</div>

{#if sheets.current.kind === 'none'}
	<button
		type="button"
		class="fab fixed z-20 grid size-14 place-items-center rounded-full bg-accent text-on-accent md:hidden"
		aria-label="Quick add"
		onclick={openQuickAdd}
		transition:scale={{ start: 0.6, duration: 200, easing: cubicOut }}
	>
		<Plus size={24} weight="bold" />
	</button>
{/if}

{#if sheets.current.kind === 'quick-add'}
	<QuickAdd defaults={sheets.current.defaults} />
{:else if sheets.current.kind === 'search'}
	<Search />
{:else if openTask && sheets.current.kind === 'task'}
	<TaskSheet task={openTask} arrival={sheets.current.arrival} />
{:else if sheets.current.kind === 'notifications'}
	<NotificationsSheet />
{/if}

<Toasts />

<style>
	.app {
		padding: 0 max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
	}

	@media (min-width: 768px) {
		.app {
			padding-top: 0.75rem;
		}
	}

	/* iOS-style scroll edge: content blurs out under the status bar instead of colliding with it. */
	.scroll-edge {
		margin: 0 -0.75rem;
		padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem 0.75rem;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		mask-image: linear-gradient(to bottom, black 70%, transparent);
	}

	.drawer {
		top: max(0.75rem, env(safe-area-inset-top));
		bottom: max(0.75rem, env(safe-area-inset-bottom));
		left: max(0.75rem, env(safe-area-inset-left));
		width: min(18rem, calc(100vw - 4.5rem));
	}

	/* The drawer floats over a full task list, so it needs a denser material than the desktop sidebar to stay legible. */
	.drawer :global(nav) {
		background: var(--drawer-bg);
	}

	.fab {
		right: max(1.25rem, calc(env(safe-area-inset-right) + 0.75rem));
		bottom: max(1.25rem, calc(env(safe-area-inset-bottom) + 0.5rem));
		box-shadow:
			0 10px 28px -8px color-mix(in srgb, var(--color-accent) 60%, transparent),
			0 2px 6px -2px var(--glass-shadow);
		transition: transform 160ms var(--ease-spring);
	}

	.fab:active {
		transform: scale(0.92);
	}
</style>
