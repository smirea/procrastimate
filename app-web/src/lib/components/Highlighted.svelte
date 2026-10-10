<script lang="ts">
	import type { Highlight } from 'shared/search.ts';

	let { highlight }: { highlight: Highlight } = $props();

	const parts = $derived.by(() => {
		const out: { text: string; match: boolean }[] = [];
		let cursor = 0;
		for (const [start, end] of highlight.ranges) {
			if (start > cursor) out.push({ text: highlight.text.slice(cursor, start), match: false });
			out.push({ text: highlight.text.slice(start, end), match: true });
			cursor = end;
		}
		out.push({ text: highlight.text.slice(cursor), match: false });
		return out;
	});
</script>

{#each parts as part, i (i)}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}

<style>
	mark {
		background: var(--token-match);
		color: inherit;
		border-radius: 0.1875rem;
		box-shadow: 0 0 0 1px var(--token-match);
	}
</style>
