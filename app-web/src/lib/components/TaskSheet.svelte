<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Task } from 'shared/task.ts';
	import TaskDetails from './TaskDetails.svelte';
	import { mobile, sheets, motion, type Arrival } from '../ui.svelte.ts';

	let { task, arrival }: { task: Task; arrival: Arrival } = $props();

	const enter = (node: Element) =>
		mobile.current
			? fly(node, motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 }))
			: fly(node, motion({ x: 40, duration: 240, easing: cubicOut, opacity: 0 }));
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={() => sheets.close()} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Task details"
	class="glass-strong sheet fixed z-50 flex flex-col md:top-3 md:right-3 md:bottom-3 md:w-[min(440px,calc(100vw-1.5rem))] md:rounded-panel"
	transition:enter
>
	{#key task.id}
		<TaskDetails {task} {arrival} />
	{/key}
</div>
