<script lang="ts">
	import { untrack } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import CalendarPlus from 'phosphor-svelte/lib/CalendarPlus';
	import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
	import Copy from 'phosphor-svelte/lib/Copy';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { WEEKDAY_NAMES, postponeOptions } from 'shared/format.ts';
	import { rowActions } from 'shared/row-actions.ts';
	import { weekdayOf, type Task } from 'shared/task.ts';
	import { scheduledDue } from 'shared/triggers.ts';
	import { completeTask, deleteTask, postponeTask, reopenTask } from '../completion.ts';
	import { copyMarkdown } from '../copy.ts';
	import { rowMenu } from '../row-menu.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { clock, motion } from '../ui.svelte.ts';

	const MARGIN = 8;

	const opened = $derived(rowMenu.current);
	const task = $derived(opened ? store.task(opened.id) : undefined);
	const offered = $derived(task && opened ? rowActions(task, !store.canEdit(task.id), opened.rolled) : null);
	const options = $derived(task && offered?.postpone ? postponeOptions(scheduledDue(task, clock.today), clock.today) : []);

	$effect(() => {
		if (opened && !task) rowMenu.close();
	});

	let menu = $state<HTMLDivElement>();
	let placement = $state({ left: 0, top: 0, origin: 'top left' });
	let returnFocus: HTMLElement | null = null;

	const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

	/** Opens at the pointer like a native context menu, flipped to stay on screen. */
	function show(node: HTMLDivElement) {
		const { x, y, keyboard } = untrack(() => rowMenu.current!);
		returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		node.showPopover();
		const width = node.offsetWidth;
		const height = node.offsetHeight;
		const viewportWidth = document.documentElement.clientWidth;
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
		const flipX = x + width > viewportWidth - MARGIN;
		const flipY = y + height > viewportHeight - MARGIN;
		placement = {
			left: Math.max(MARGIN, flipX ? x - width : x),
			top: Math.max(MARGIN, flipY ? y - height : y),
			origin: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`,
		};
		(keyboard ? items()[0] : node)?.focus({ preventScroll: true });
	}

	/** Runs before the outro, which makes the menu inert and would drop its focus to the body. */
	$effect.pre(() => {
		if (opened || !returnFocus) return;
		if (!document.activeElement || document.activeElement === document.body || menu?.contains(document.activeElement)) {
			returnFocus.focus({ preventScroll: true });
		}
		returnFocus = null;
	});

	/** Closing clears `opened` and `task`, so the action gets what the menu was open on. */
	function run(action: (task: Task, rowToggle?: () => void) => void) {
		const target = task!;
		const rowToggle = opened!.toggle;
		rowMenu.close();
		action(target, rowToggle);
	}

	function toggle(target: Task, rowToggle?: () => void) {
		if (rowToggle) rowToggle();
		else if (target.completedAt === null) completeTask(target);
		else reopenTask(target);
	}

	function onkeydown(event: KeyboardEvent) {
		const list = items();
		const at = list.indexOf(document.activeElement as HTMLElement);
		const next = { ArrowDown: at + 1, ArrowUp: (at < 0 ? list.length : at) - 1, Home: 0, End: list.length - 1 }[event.key];
		if (next !== undefined) {
			event.preventDefault();
			list[(next + list.length) % list.length]?.focus();
		} else if (event.key === 'Tab') {
			event.preventDefault();
			rowMenu.close();
		}
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (opened && event.key === 'Escape') {
			event.stopImmediatePropagation();
			event.preventDefault();
			rowMenu.close();
		}
	}

	function onWindowPointerdown(event: PointerEvent) {
		if (opened && !menu?.contains(event.target as Node)) rowMenu.close();
	}

	function onWindowScroll(event: Event) {
		if (opened && !menu?.contains(event.target as Node)) rowMenu.close();
	}
</script>

<svelte:window
	onkeydowncapture={onWindowKeydown}
	onpointerdowncapture={onWindowPointerdown}
	onscrollcapture={onWindowScroll}
	onblur={() => rowMenu.close()}
/>

{#if opened && task && offered}
	<div
		bind:this={menu}
		{@attach show}
		popover="manual"
		role="menu"
		tabindex="-1"
		aria-label={task.title}
		class="menu glass-strong w-60 rounded-popover p-1.5 outline-none"
		style:left={`${placement.left}px`}
		style:top={`${placement.top}px`}
		style:transform-origin={placement.origin}
		transition:scale={motion({ start: 0.92, duration: 160, easing: cubicOut, opacity: 0 })}
		oncontextmenu={(e) => e.preventDefault()}
		{onkeydown}
	>
		{#if offered.toggle}
			<button type="button" role="menuitem" class="menu-item" onclick={() => run(toggle)}>
				{#if offered.toggle === 'complete'}
					<CheckCircle size={16} class="shrink-0" />Complete
				{:else}
					<ArrowCounterClockwise size={16} class="shrink-0" />Reopen
				{/if}
			</button>
		{/if}
		{#if options.length}
			<div role="group" aria-labelledby="row-menu-postpone" class="my-1 border-y border-ink/5 py-1">
				<div id="row-menu-postpone" class="flex items-center gap-2 px-2.5 pt-1 pb-0.5 text-[12px] font-medium text-muted">
					<CalendarPlus size={14} class="shrink-0" />Postpone
				</div>
				{#each options as option (option.date)}
					<button type="button" role="menuitem" class="menu-item justify-between pl-8" onclick={() => run((target) => postponeTask(target, option.date))}>
						{option.label}<span class="text-muted">{WEEKDAY_NAMES[weekdayOf(option.date)]}</span>
					</button>
				{/each}
			</div>
		{/if}
		{#if offered.delete}
			<button type="button" role="menuitem" class="menu-item text-[var(--tone-overdue)]!" onclick={() => run(deleteTask)}>
				<Trash size={16} class="shrink-0" />Delete
			</button>
		{/if}
		<button
			type="button"
			role="menuitem"
			class="menu-item"
			onclick={() => run((target) => void copyMarkdown({ title: null, sections: [{ heading: null, tasks: [target] }] }))}
		>
			<Copy size={16} class="shrink-0" />Copy as Markdown
		</button>
	</div>
{/if}

<style>
	.menu {
		position: fixed;
		inset: auto;
		margin: 0;
		border: 0;
		color: inherit;
	}
</style>
