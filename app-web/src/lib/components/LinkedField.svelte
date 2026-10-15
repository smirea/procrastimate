<script lang="ts">
	import type { Snippet } from 'svelte';
	import { linkify } from 'shared/links.ts';
	import LinkedText from './LinkedText.svelte';

	let { text, class: layer, children }: { text: string; class: string; children: Snippet } = $props();

	let focused = $state(false);
	const linked = $derived(!focused && linkify(text).some((segment) => segment.href));
</script>

<!-- Until the field takes focus, its text shows with live links on a layer above it. Clicks outside a link fall
     through to the field, which then shows the raw text for editing. Chromium focuses a link on mousedown, and
     dropping the layer then would swallow the click, so focus on a link does not count. -->
<div class="relative" class:linked onfocusin={(e) => (focused = !(e.target instanceof HTMLAnchorElement))} onfocusout={() => (focused = false)}>
	{@render children()}
	{#if linked}
		<div class="pointer-events-none absolute inset-0 overflow-hidden {layer}"><LinkedText {text} /></div>
	{/if}
</div>

<style>
	.linked :global(:is(input, textarea)) {
		color: transparent;
	}
</style>
