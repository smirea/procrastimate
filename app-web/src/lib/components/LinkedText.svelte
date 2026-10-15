<script lang="ts">
	import { linkify } from 'shared/links.ts';
	import type { Range } from 'shared/search.ts';
	import Highlighted from './Highlighted.svelte';

	let { text, ranges = [] }: { text: string; ranges?: readonly Range[] } = $props();

	const segments = $derived(linkify(text, ranges));
</script>

{#each segments as segment, i (i)}{#if segment.href}<a
			href={segment.href}
			target="_blank"
			rel="noopener noreferrer"
			class="link"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}><Highlighted highlight={{ text: segment.text, ranges: segment.marks }} /></a
		>{:else}<Highlighted highlight={{ text: segment.text, ranges: segment.marks }} />{/if}{/each}

<style>
	.link {
		/* Rows and fields lay this text over their button or input with pointer events off. */
		pointer-events: auto;
		color: var(--color-accent);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		text-underline-offset: 2px;
		transition: text-decoration-color 150ms;
	}
	.link:hover {
		text-decoration-color: currentColor;
	}
</style>
