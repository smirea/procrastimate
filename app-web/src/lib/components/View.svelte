<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { sheets } from '../ui.svelte.ts';

	let {
		title,
		subtitle,
		empty,
		emptyTitle,
		emptyHint,
		quickAdd,
		actions,
		children,
	}: {
		title: Snippet | string;
		subtitle?: string;
		empty: boolean;
		emptyTitle: string;
		emptyHint: string;
		quickAdd: { projectId: string | null; today: boolean };
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section in:fly={{ y: 6, duration: 220, easing: cubicOut }}>
	<header class="mb-5 flex items-end justify-between gap-4">
		<div class="min-w-0">
			{#if typeof title === 'string'}
				<h1 class="truncate text-[26px] font-semibold tracking-tight">{title}</h1>
			{:else}
				{@render title()}
			{/if}
			{#if subtitle}<p class="mt-0.5 text-[13px] text-muted">{subtitle}</p>{/if}
		</div>
		{@render actions?.()}
	</header>

	{@render children()}

	<button
		type="button"
		class="group mt-1 flex h-10 w-full items-center gap-3 rounded-xl px-2 text-[14px] text-muted transition-colors hover:text-accent"
		onclick={() => sheets.openQuickAdd(quickAdd)}
	>
		<span class="grid size-[18px] place-items-center rounded-full text-accent transition-colors group-hover:bg-accent group-hover:text-white">
			<Plus size={13} weight="bold" />
		</span>
		Add task
	</button>

	{#if empty}
		<div class="mt-16 text-center" in:fade={{ duration: 240, delay: 120 }}>
			<p class="text-[15px] font-medium">{emptyTitle}</p>
			<p class="mt-1 text-[13px] text-muted">{emptyHint}</p>
		</div>
	{/if}
</section>
