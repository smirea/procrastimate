<script module lang="ts">
	const remeasure = new WeakMap<Element, () => void>();
	const widths = new WeakMap<Element, number>();
	let observer: ResizeObserver | undefined;

	/** One observer for every row. A title only reflows when its width changes, so height changes are ignored. */
	function observe(el: Element, measure: () => void) {
		observer ??= new ResizeObserver((entries) => {
			for (const entry of entries) {
				const width = entry.contentRect.width;
				if (widths.get(entry.target) === width) continue;
				widths.set(entry.target, width);
				remeasure.get(entry.target)?.();
			}
		});
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
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Tag from 'phosphor-svelte/lib/Tag';
	import type { Highlight, Range } from 'shared/search.ts';
	import LinkedText from './LinkedText.svelte';
	import Highlighted from './Highlighted.svelte';
	import { motion } from '../ui.svelte.ts';

	let {
		title,
		ranges,
		labels,
		class: className = '',
	}: { title: string; ranges?: readonly Range[]; labels: readonly Highlight[]; class?: string } = $props();

	let flow: HTMLElement;
	/**
	 * The labels follow the title inline. When the title and labels need more than two lines, the labels float to the
	 * end of the second line instead, so the title takes the ellipsis and the labels stay visible.
	 */
	let clamped = $state(false);

	async function measure() {
		if (!labels.length) {
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
			<span class="label-chip" data-label={label.text} transition:scale={motion({ start: 0.6, duration: 180, easing: cubicOut })}>
				<Tag size={10} weight="fill" class="shrink-0 text-[var(--tone-label)]" />
				<span class="truncate"><Highlighted highlight={label} /></span>
			</span>
		{/each}
	</span>
{/snippet}

<!-- The flex parent gives the clamped box a definite height, which the float spacer's percentage needs. -->
<div class="flex">
	<div bind:this={flow} class="flow {className}" class:clamped>
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

	.clamped::before {
		content: '';
		float: right;
		height: calc(100% - 1lh);
	}

	.chips {
		text-decoration: none;
	}

	.chips:not(.float) .label-chip {
		margin: calc((1lh - 1.125rem) / 2) 0 0 0.25rem;
		vertical-align: top;
	}

	.float .label-chip {
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
