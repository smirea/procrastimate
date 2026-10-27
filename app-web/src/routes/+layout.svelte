<script lang="ts">
	import '../index.css';
	import { untrack, type Snippet } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import List from 'phosphor-svelte/lib/List';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import QuickAdd from '#lib/components/QuickAdd.svelte';
	import RambleDrawer from '#lib/ramble/RambleDrawer.svelte';
	import Search from '#lib/components/Search.svelte';
	import SettingsSheet from '#lib/components/SettingsSheet.svelte';
	import ShareSheet from '#lib/components/ShareSheet.svelte';
	import TaskSheet from '#lib/components/TaskSheet.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import RowMenu from '#lib/components/RowMenu.svelte';
	import ImageViewer from '#lib/components/ImageViewer.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { forgetAdded, quickAddDefaults } from '#lib/screen.ts';
	import { clock, sheets, trackKeyboardInset, motion } from '#lib/ui.svelte.ts';
	import { keepCaretInView } from '#lib/caret.ts';
	import { notifyDueReminders } from '#lib/reminders.ts';
	import { openTaskFromUrl, push } from '#lib/push.svelte.ts';
	import { session } from '#lib/session.svelte.ts';
	import { runSentrySmoke } from '#lib/sentry.ts';
	import SignIn from '#lib/components/SignIn.svelte';
	import { startSync } from '#lib/sync.svelte.ts';
	import { keepStorage } from '#lib/device.ts';
	import { applyTheme, theme } from '#lib/theme.svelte.ts';

	let { children }: { children: Snippet } = $props();
	let menuOpen = $state(false);

	/** A public link renders for anyone, signed in or not, outside the app's chrome. */
	const isPublic = $derived(page.route.id === '/s/[token]');
	const openTask = $derived(sheets.current.kind === 'task' ? store.task(sheets.current.id) : undefined);
	$effect(() => {
		if (sheets.current.kind === 'task' && store.loaded && !openTask) untrack(() => sheets.close());
	});

	/** The task whose details are up, or were before a share sheet opened from them. */
	let shownTask: string | null = null;
	$effect(() => {
		const current = sheets.current;
		const id = current.kind === 'task' ? current.id : current.kind === 'share' ? current.from : null;
		const left = shownTask;
		shownTask = id;
		// Quick add expands an untitled draft into details. Left untitled, it was never a task, so it goes without an undo.
		if (left && left !== id && untrack(() => store.task(left)?.title === '')) store.deleteTask(left);
	});

	afterNavigate(({ to }) => forgetAdded(to?.url.pathname ?? ''));

	function openQuickAdd() {
		menuOpen = false;
		sheets.openQuickAdd(quickAddDefaults());
	}

	function openSearch() {
		menuOpen = false;
		sheets.openSearch();
	}

	function openSettings() {
		menuOpen = false;
		sheets.openSettings();
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
		if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
		if (event.key === 'q' && sheets.current.kind === 'none') {
			event.preventDefault();
			openQuickAdd();
		} else if (event.key === 'Escape' && sheets.current.kind !== 'none') {
			sheets.close();
		} else if (event.key === 'Escape' && menuOpen) {
			menuOpen = false;
		}
	}

	$effect(() => applyTheme(theme.resolved, theme.accent));
	$effect(() => clock.start());
	$effect(() => trackKeyboardInset());
	$effect(() => keepCaretInView());
	$effect(() => untrack(() => void session.start().then(runSentrySmoke)));
	$effect(() => {
		const userId = session.userId;
		if (session.state !== 'in' || !session.confirmed || !userId) return;
		void keepStorage().catch(() => {});
		const stopPush = untrack(() => push.start());
		const stopSync = untrack(() => startSync(userId));
		return () => {
			stopPush();
			stopSync();
		};
	});

	$effect(() => {
		if (session.state === 'in' && session.confirmed && store.loaded) untrack(openTaskFromUrl);
	});

	// Only once the local database is read, or the check would pass every reminder that came up while closed.
	$effect(() => {
		const now = clock.now;
		if (store.loaded) untrack(() => notifyDueReminders(now));
	});

	$effect(() => {
		void page.url.pathname;
		menuOpen = false;
	});

</script>

<svelte:window {onkeydown} />

{#if isPublic}
	{@render children()}
{:else if session.state === 'out'}
	<SignIn />
{:else if session.state === 'in' && store.unreadable}
<main class="grid min-h-dvh place-items-center p-4">
	<div role="alert" class="glass-strong flex w-full max-w-sm flex-col gap-3 rounded-3xl p-6">
		<h1 class="text-[22px] font-semibold tracking-tight text-ink">Couldn’t open your tasks</h1>
		<p class="text-[15px] text-muted">This browser could not read its copy of your tasks. Nothing you change would be saved until it can.</p>
		<button type="button" class="btn press bg-accent text-on-accent" onclick={() => location.reload()}>Reload</button>
	</div>
</main>
{:else if session.state === 'in' && store.loaded}
<div class="app flex min-h-dvh gap-3">
	<div class="sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-64 shrink-0 md:block">
		<Sidebar onquickadd={openQuickAdd} onsearch={openSearch} onsettings={openSettings} />
	</div>
	{#if menuOpen}
		<div class="fixed inset-0 z-30 bg-scrim backdrop-blur-[2px] md:hidden" transition:fade={motion({ duration: 180 })} onclick={() => (menuOpen = false)} aria-hidden="true"></div>
		<div class="drawer fixed z-30 md:hidden" transition:fly={motion({ x: -320, duration: 280, easing: cubicOut, opacity: 1 })}>
			<Sidebar onquickadd={openQuickAdd} onsearch={openSearch} onsettings={openSettings} />
		</div>
	{/if}
	<main class="min-w-0 flex-1">
		<header class="scroll-edge sticky top-0 z-20 flex items-center md:hidden">
			<button
				type="button"
				class="glass press grid size-11 place-items-center rounded-full"
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
		transition:scale={motion({ start: 0.6, duration: 200, easing: cubicOut })}
	>
		<Plus size={24} weight="bold" />
	</button>
{/if}

{#if sheets.current.kind === 'quick-add'}
	{@const defaults = sheets.current.defaults}
	<QuickAdd {defaults} />
{:else if sheets.current.kind === 'ramble'}
	<RambleDrawer defaults={sheets.current.defaults} />
{:else if sheets.current.kind === 'search'}
	<Search />
{:else if sheets.current.kind === 'settings'}
	<SettingsSheet />
{:else if sheets.current.kind === 'share'}
	<ShareSheet target={sheets.current.target} name={sheets.current.name} />
{:else if openTask && sheets.current.kind === 'task'}
	<TaskSheet task={openTask} arrival={sheets.current.arrival} />
{/if}

<ImageViewer />
<RowMenu />
<Toasts />
{/if}

<style>
	.app {
		padding: 0 max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
	}

	@media (min-width: 768px) {
		.app {
			padding-top: 0.75rem;
		}
	}

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

	/* The drawer floats over a full task list, so it takes the dense material instead of the desktop sidebar's. */
	.drawer :global(nav) {
		--glass-fill: var(--glass-strong-bg);
		-webkit-backdrop-filter: blur(30px) saturate(190%);
		backdrop-filter: blur(30px) saturate(190%);
	}

	@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
		.drawer :global(nav) {
			--glass-fill: var(--glass-solid);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}

	.fab {
		right: max(1.25rem, calc(env(safe-area-inset-right) + 0.75rem));
		bottom: max(1.25rem, calc(env(safe-area-inset-bottom) + 0.5rem));
		box-shadow:
			inset 0 1px 0 0 rgb(255 255 255 / 0.3),
			inset 0 -1px 0 0 rgb(0 0 0 / 0.08),
			0 10px 28px -8px color-mix(in srgb, var(--color-accent) 60%, transparent),
			0 2px 6px -2px var(--glass-shadow);
		transition: scale 220ms var(--ease-spring);
	}

	.fab:active {
		scale: 0.9;
	}
</style>
