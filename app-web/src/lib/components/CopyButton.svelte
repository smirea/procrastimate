<script lang="ts">
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Copy from 'phosphor-svelte/lib/Copy';
	import Check from 'phosphor-svelte/lib/Check';
	import type { MarkdownDocument } from 'shared/markdown.ts';
	import { copyMarkdown } from '../copy.ts';
	import { motion } from '../ui.svelte.ts';

	let {
		label,
		markdown,
		size = 16,
		class: className = '',
	}: { label: string; markdown: () => MarkdownDocument; size?: number; class?: string } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		if (!(await copyMarkdown(markdown()))) return;
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1200);
	}
</script>

<button type="button" class="icon-btn {className}" aria-label={label} title={label} onclick={copy}>
	{#key copied}
		<span class="col-start-1 row-start-1 grid place-items-center" class:text-accent={copied} in:scale={motion({ start: 0.5, duration: 180, easing: cubicOut })} out:scale={motion({ start: 0.5, duration: 120 })}>
			{#if copied}<Check {size} weight="bold" />{:else}<Copy {size} />{/if}
		</span>
	{/key}
</button>
