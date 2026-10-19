<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { mobile, motion, sheets } from '../ui.svelte.ts';

	/** On a phone every sheet rises from the bottom; on a desktop each keeps its own entrance. */
	let {
		label,
		desktop,
		class: classes,
		children,
	}: { label: string; desktop: 'scale' | 'slide' | 'fly'; class: string; children: Snippet } = $props();

	const enter = (node: Element) => {
		if (mobile.current || desktop === 'fly') return fly(node, motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 }));
		if (desktop === 'slide') return fly(node, motion({ x: 40, duration: 240, easing: cubicOut, opacity: 0 }));
		return scale(node, motion({ start: 0.96, duration: 200, easing: cubicOut, opacity: 0 }));
	};
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={() => sheets.close()} aria-hidden="true"></div>
<div role="dialog" aria-label={label} class={`glass-strong sheet fixed z-50 flex ${classes}`} transition:enter>
	{@render children()}
</div>
