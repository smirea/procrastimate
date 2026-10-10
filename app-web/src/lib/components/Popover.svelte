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

	let open = $state(false);
	let root: HTMLDivElement;

	const close = () => (open = false);
	const toggle = () => (open = !open);

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
			role="dialog"
			aria-label={label}
			class="glass-strong absolute z-50 mt-1.5 min-w-56 rounded-xl p-1.5 {align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'}"
			transition:scale={{ start: 0.94, duration: 160, easing: cubicOut, opacity: 0 }}
		>
			{@render children({ close })}
		</div>
	{/if}
</div>
