<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { pendingCount } from 'shared/views.ts';
	import { motion } from '../ui.svelte.ts';

	/** `open` is the number of rows the list shows. */
	let { open, class: className = '' }: { open: number; class?: string } = $props();

	const count = $derived(pendingCount(open));
</script>

{#if count !== null}
	<span class="shrink-0 font-normal text-faint tabular-nums {className}" transition:fade={motion({ duration: 160 })}>
		<!-- No out transition, so the old number never sits beside the new one and nothing reflows. -->
		{#key count}
			<span class="inline-block" in:fly={motion({ y: -3, duration: 180, easing: cubicOut })}>{count}</span>
		{/key}<span class="sr-only">{' '}open tasks</span>
	</span>
{/if}
