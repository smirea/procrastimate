<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { MarkdownDocument } from 'shared/markdown.ts';
	import AddTaskButton from './AddTaskButton.svelte';
	import CopyButton from './CopyButton.svelte';
	import PendingCount from './PendingCount.svelte';
	import { motion } from '../ui.svelte.ts';

	let {
		name,
		title,
		subtitle,
		open,
		empty,
		emptyTitle,
		emptyHint,
		canAdd = true,
		actions,
		markdown,
		children,
		after,
	}: {
		/** What the view is called: the heading, unless `title` renders one, and the copy button's label. */
		name: string;
		title?: Snippet;
		subtitle?: string;
		/** The open rows the view lists, for the count beside the title. */
		open?: number;
		empty: boolean;
		emptyTitle: string;
		emptyHint: string;
		canAdd?: boolean;
		actions?: Snippet;
		markdown: () => MarkdownDocument;
		children: Snippet;
		/** Below the add button and the empty state, such as a view's completed tasks. */
		after?: Snippet;
	} = $props();
</script>

<section in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}>
	<header class="mb-5 flex items-end justify-between gap-4">
		<div class="min-w-0">
			<div class="flex min-w-0 items-baseline gap-2.5">
				{#if title}
					{@render title()}
				{:else}
					<h1 class="truncate text-[26px] font-semibold tracking-tight">{name}</h1>
				{/if}
				{#if open !== undefined}<PendingCount {open} class="text-[15px]" />{/if}
			</div>
			{#if subtitle}<p class="mt-0.5 text-[13px] text-muted">{subtitle}</p>{/if}
		</div>
		<div class="flex shrink-0 items-center gap-1">
			<CopyButton label={`Copy ${name} as Markdown`} {markdown} />
			{@render actions?.()}
		</div>
	</header>

	{@render children()}

	{#if canAdd}
		<AddTaskButton />
	{/if}

	{#if empty}
		<div class="mt-16 text-center" in:fade={motion({ duration: 240, delay: 120 })}>
			<p class="text-[15px] font-medium">{emptyTitle}</p>
			<p class="mt-1 text-[13px] text-muted">{emptyHint}</p>
		</div>
	{/if}

	{@render after?.()}
</section>
