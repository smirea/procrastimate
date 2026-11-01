<script lang="ts">
	import { linkify } from 'shared/links.ts';
	import type { Range } from 'shared/search.ts';
	import Highlighted from './Highlighted.svelte';
	import { faviconFailed, faviconSrc } from '../link-preview.svelte.ts';

	let { text, ranges = [] }: { text: string; ranges?: readonly Range[] } = $props();

	const segments = $derived(linkify(text, ranges));
</script>

{#each segments as segment, i (i)}{@const icon = segment.href && faviconSrc(segment.href)}{#if segment.href}<a
			href={segment.href}
			target="_blank"
			rel="noopener noreferrer"
			class="link"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			>{#if icon}<img
					class="favicon"
					src={icon}
					alt=""
					loading="lazy"
					onerror={() => faviconFailed(icon)}
				/>{/if}<Highlighted highlight={{ text: segment.text, ranges: segment.marks }} /></a
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
	.favicon {
		display: inline-block;
		width: 1em;
		height: 1em;
		margin-right: 0.25em;
		vertical-align: -0.125em;
		border-radius: 0.2em;
		object-fit: contain;
	}
	.link:hover {
		text-decoration-color: currentColor;
	}
</style>
