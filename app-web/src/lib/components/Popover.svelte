<script lang="ts">
	import type { Snippet } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let {
		trigger,
		children,
		align = 'start',
		label,
	}: {
		trigger: Snippet<[{ open: boolean; toggle: () => void }]>;
		children: Snippet<[{ close: () => void }]>;
		align?: 'start' | 'end';
		label: string;
	} = $props();

	const GAP = 6;
	const MARGIN = 8;

	let open = $state(false);
	let root: HTMLDivElement;
	let panel = $state<HTMLDivElement>();
	let placement = $state({ above: false, shift: 0, maxHeight: 0 });

	const close = () => (open = false);
	const toggle = () => (open = !open);

	/**
	 * Keeps the panel inside the visible viewport, which matters most in bottom sheets on phones and above the
	 * on-screen keyboard. Inside a sheet it also stays below the sheet's header, so it never covers Close.
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
		placement = { above: flip, shift, maxHeight: flip ? above : below };
	}

	$effect(() => {
		if (panel) place(panel);
	});

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

<svelte:window onkeydowncapture={onWindowKeydown} onpointerdowncapture={onWindowPointerdown} />

<div class="relative" bind:this={root}>
	{@render trigger({ open, toggle })}
	{#if open}
		<div
			bind:this={panel}
			role="dialog"
			aria-label={label}
			class="glass-strong absolute z-50 min-w-56 overflow-y-auto overscroll-contain rounded-xl p-1.5"
			class:right-0={align === 'end'}
			class:left-0={align === 'start'}
			class:top-full={!placement.above}
			class:bottom-full={placement.above}
			style:margin-block={`${GAP}px`}
			style:translate={`${placement.shift}px 0`}
			style:max-height={placement.maxHeight ? `${placement.maxHeight}px` : undefined}
			style:transform-origin={`${placement.above ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`}
			transition:scale={{ start: 0.94, duration: 160, easing: cubicOut, opacity: 0 }}
		>
			{@render children({ close })}
		</div>
	{/if}
</div>
