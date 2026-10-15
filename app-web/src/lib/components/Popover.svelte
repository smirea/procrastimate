<script lang="ts">
	import type { Snippet } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { motion } from '../ui.svelte.ts';

	let {
		trigger,
		children,
		align = 'start',
		label,
		open = $bindable(false),
	}: {
		trigger: Snippet<[{ open: boolean; toggle: () => void }]>;
		children: Snippet<[{ close: () => void }]>;
		align?: 'start' | 'end';
		label: string;
		open?: boolean;
	} = $props();

	const GAP = 6;
	const MARGIN = 8;

	let root: HTMLDivElement;
	let panel = $state<HTMLDivElement>();
	let placement = $state({ above: false, left: 0, top: 0, maxHeight: 0 });

	const close = () => (open = false);
	const toggle = () => (open = !open);

	/**
	 * Keeps the panel inside the visible viewport, which matters most in bottom sheets on phones and above the
	 * on-screen keyboard. Inside a sheet it also stays below the sheet's header, so it never covers Close.
	 * The panel lives in the top layer at fixed coordinates, so a scrolling row such as quick add's chips never
	 * clips it.
	 */
	function place(panel: HTMLDivElement) {
		const anchor = root.getBoundingClientRect();
		const viewportWidth = document.documentElement.clientWidth;
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
		const top = root.closest('.sheet')?.querySelector(':scope > header')?.getBoundingClientRect().bottom ?? 0;
		const width = panel.offsetWidth;
		const left = align === 'end' ? anchor.right - width : anchor.left;
		const shift = Math.max(MARGIN - left, Math.min(0, viewportWidth - MARGIN - (left + width)));
		const below = viewportHeight - anchor.bottom - GAP - MARGIN;
		const above = anchor.top - top - GAP - MARGIN;
		const flip = panel.scrollHeight > below && above > below;
		placement = {
			above: flip,
			left: left + shift,
			top: flip ? anchor.top - GAP : anchor.bottom + GAP,
			maxHeight: flip ? above : below,
		};
	}

	$effect(() => {
		if (!panel) return;
		panel.showPopover();
		place(panel);
	});

	/** The anchor can move under a fixed panel, as when its row scrolls, so the panel follows it. */
	function onWindowMove() {
		if (panel) place(panel);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.stopImmediatePropagation();
			event.preventDefault();
			close();
		}
	}

	function onWindowPointerdown(event: PointerEvent) {
		if (open && !root.contains(event.target as Node)) close();
	}
</script>

<svelte:window
	onkeydowncapture={onWindowKeydown}
	onpointerdowncapture={onWindowPointerdown}
	onscrollcapture={onWindowMove}
	onresize={onWindowMove}
/>

<div class="relative min-w-0" bind:this={root}>
	{@render trigger({ open, toggle })}
	{#if open}
		<div
			bind:this={panel}
			popover="manual"
			role="dialog"
			aria-label={label}
			class="panel glass-strong min-w-56 overflow-y-auto overscroll-contain rounded-popover p-1.5"
			style:left={`${placement.left}px`}
			style:top={`${placement.top}px`}
			style:translate={placement.above ? '0 -100%' : undefined}
			style:max-height={placement.maxHeight ? `${placement.maxHeight}px` : undefined}
			style:transform-origin={`${placement.above ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`}
			transition:scale={motion({ start: 0.94, duration: 180, easing: cubicOut, opacity: 0 })}
		>
			{@render children({ close })}
		</div>
	{/if}
</div>

<style>
	.panel {
		position: fixed;
		inset: auto;
		margin: 0;
		border: 0;
		color: inherit;
	}
</style>
