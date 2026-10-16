<script module lang="ts">
	const remeasure = new Map<Element, () => void>();
	const widths = new WeakMap<Element, number>();
	let observer: ResizeObserver | undefined;

	/**
	 * One observer for every row. A title reflows when its width changes, so height changes are ignored, or when a font
	 * finishes loading, since rows measured with the fallback font can wrap differently at the same width.
	 */
	function observe(el: Element, measure: () => void) {
		if (!observer) {
			observer = new ResizeObserver((entries) => {
				for (const entry of entries) {
					const width = entry.contentRect.width;
					if (widths.get(entry.target) === width) continue;
					widths.set(entry.target, width);
					remeasure.get(entry.target)?.();
				}
			});
			document.fonts.addEventListener('loadingdone', () => remeasure.forEach((measure) => measure()));
		}
		remeasure.set(el, measure);
		observer.observe(el);
		return () => {
			observer?.unobserve(el);
			remeasure.delete(el);
			widths.delete(el);
		};
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import type { LabelColor } from 'shared/label-colors.ts';
	import type { Highlight, Range } from 'shared/search.ts';
	import LinkedText from './LinkedText.svelte';
	import Highlighted from './Highlighted.svelte';
	import LabelChip from './LabelChip.svelte';

	let {
		title,
		ranges,
		labels,
		wrap = false,
		class: className = '',
	}: {
		title: string;
		ranges?: readonly Range[];
		labels: readonly (Highlight & { color: LabelColor })[];
		/** Shows the whole title over as many lines as it needs instead of two. */
		wrap?: boolean;
		class?: string;
	} = $props();

	let flow: HTMLElement;
	/**
	 * The labels follow the title inline. When the title and labels need more than two lines, the labels float to the
	 * end of the second line instead, so the title takes the ellipsis and the labels stay visible.
	 */
	let clamped = $state(false);

	async function measure() {
		if (!labels.length || wrap) {
			clamped = false;
			return;
		}
		clamped = false;
		await tick();
		clamped = flow.scrollHeight > flow.clientHeight + 1;
	}

	$effect(() => observe(flow, measure));
	$effect(() => {
		void [title, labels];
		void measure();
	});
</script>

{#snippet chips(float: boolean)}
	<span class={float ? 'chips float' : 'chips'}>
		{#each labels as label (label.text)}
			<LabelChip name={label.text} color={label.color}><span class="truncate"><Highlighted highlight={label} /></span></LabelChip>
		{/each}
	</span>
{/snippet}

<!-- The flex parent gives the clamped box a definite height, which the float spacer's percentage needs. -->
<div class="flex">
	<div bind:this={flow} class="flow {className}" class:clamped class:wrap>
		{#if clamped}{@render chips(true)}{/if}<LinkedText text={title} {ranges} />{#if labels.length && !clamped}{@render chips(false)}{/if}
	</div>
</div>

<style>
	.flow {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		overflow-wrap: anywhere;
		min-width: 0;
		flex: 1;
	}

	.wrap {
		-webkit-line-clamp: unset;
		line-clamp: none;
	}

	.clamped::before {
		content: '';
		float: right;
		height: calc(100% - 1lh);
	}

	.chips {
		text-decoration: none;
	}

	.chips:not(.float) :global(.label-chip) {
		margin: calc((1lh - 1.125rem) / 2) 0 0 0.25rem;
		vertical-align: top;
	}

	.float :global(.label-chip) {
		min-width: 0;
	}

	.float {
		float: right;
		clear: both;
		display: flex;
		gap: 0.25rem;
		height: 1lh;
		max-width: 60%;
		overflow: hidden;
		align-items: center;
		margin-left: 0.25rem;
	}
</style>
