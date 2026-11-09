<script lang="ts">
	import { untrack } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { postponeOptions } from 'shared/format.ts';
	import type { Due } from 'shared/task.ts';
	import { scheduledDays, scheduledDue } from 'shared/triggers.ts';
	import DuePanel from './DuePanel.svelte';
	import { toastPostponed } from '../completion.ts';
	import { MARGIN, viewportHeight } from '../placement.ts';
	import { postponer } from '../row-menu.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { clock } from '../clock.svelte.ts';
	import { motion } from '../motion.ts';
	import { sheets } from '../sheets.svelte.ts';

	const opened = $derived(postponer.current);
	const task = $derived(opened ? store.task(opened.id) : undefined);
	/** Read once on open, so the presets hold still while the picks move the task. */
	const presets = $derived.by(() => {
		if (!opened) return [];
		return untrack(() => {
			const target = store.task(opened.id);
			return target ? postponeOptions(scheduledDue(target, clock.today), clock.today, scheduledDays(store.own.tasks, clock.today)) : [];
		});
	});

	$effect(() => {
		if (opened && !task) postponer.close();
	});

	$effect(() => {
		void sheets.current;
		untrack(() => close());
	});

	let panel = $state<HTMLDivElement>();
	let placement = $state({ left: 0, top: 0 });
	let returnFocus: HTMLElement | null = null;

	function show(node: HTMLDivElement) {
		const { x, y } = untrack(() => postponer.current!);
		returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		node.showPopover();
		const viewportWidth = document.documentElement.clientWidth;
		placement = {
			left: Math.max(MARGIN, Math.min(x, viewportWidth - MARGIN - node.offsetWidth)),
			top: Math.max(MARGIN, Math.min(y, viewportHeight() - MARGIN - node.offsetHeight)),
		};
		node.focus({ preventScroll: true });
	}

	/** The toast waits for the close, so a run of picks and time changes reads as one move with one Undo. */
	function close() {
		const current = postponer.current;
		if (!current) return;
		postponer.close();
		const target = store.task(current.id);
		if (target) toastPostponed(target, current.original);
	}

	function change(due: Due | null) {
		if (task) store.updateTask(task.id, { due });
	}

	$effect.pre(() => {
		if (opened || !returnFocus) return;
		if (!document.activeElement || document.activeElement === document.body || panel?.contains(document.activeElement)) {
			returnFocus.focus({ preventScroll: true });
		}
		returnFocus = null;
	});

	function onWindowKeydown(event: KeyboardEvent) {
		if (opened && event.key === 'Escape') {
			event.stopImmediatePropagation();
			event.preventDefault();
			close();
		}
	}

	function onWindowPointerdown(event: PointerEvent) {
		if (opened && !panel?.contains(event.target as Node)) close();
	}
</script>

<svelte:window onkeydowncapture={onWindowKeydown} onpointerdowncapture={onWindowPointerdown} />

{#if opened && task}
	<div
		bind:this={panel}
		{@attach show}
		popover="manual"
		role="dialog"
		tabindex="-1"
		aria-label={`Postpone ${task.title}`}
		class="panel glass-strong max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-popover p-1.5 outline-none"
		style:left={`${placement.left}px`}
		style:top={`${placement.top}px`}
		transition:scale={motion({ start: 0.94, duration: 180, easing: cubicOut, opacity: 0 })}
	>
		<DuePanel due={task.due} {presets} closesOnDay onchange={change} {close} />
	</div>
{/if}

<style>
	.panel {
		position: fixed;
		inset: auto;
		margin: 0;
		border: 0;
		color: inherit;
		transform-origin: top left;
	}
</style>
