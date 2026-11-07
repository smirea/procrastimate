<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { mobile, motion } from '../motion.ts';
	import { sheets } from '../sheets.svelte.ts';

	/** On a phone every sheet rises from the bottom; on a desktop each keeps its own entrance. */
	let {
		label,
		desktop,
		class: classes,
		children,
		onclose = () => sheets.close(),
		...rest
	}: { label: string; desktop: 'scale' | 'slide' | 'fly'; class: string; children: Snippet; onclose?: () => void } & Pick<
		HTMLAttributes<HTMLDivElement>,
		'onpaste' | 'ondragover' | 'ondrop'
	> = $props();

	const enter = (node: Element) => {
		if (mobile.current || desktop === 'fly') return fly(node, motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 }));
		if (desktop === 'slide') return fly(node, motion({ x: 40, duration: 240, easing: cubicOut, opacity: 0 }));
		return scale(node, motion({ start: 0.96, duration: 200, easing: cubicOut, opacity: 0 }));
	};
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={onclose} aria-hidden="true"></div>
<div role="dialog" aria-label={label} class={`glass-strong sheet fixed z-50 flex ${classes}`} transition:enter {...rest}>
	{@render children()}
</div>
