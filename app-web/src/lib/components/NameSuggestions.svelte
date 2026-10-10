<script lang="ts">
	import Plus from 'phosphor-svelte/lib/Plus';
	import type { Named, Suggestion } from 'shared/name-search.ts';
	import type { NameSource } from '../names.ts';

	let {
		id,
		source,
		suggestions,
		query,
		active,
		onpick,
	}: {
		id: string;
		source: NameSource;
		suggestions: Suggestion<Named>[];
		query: string;
		active: number;
		onpick: (suggestion: Suggestion<Named>) => void;
	} = $props();

	let list: HTMLDivElement;

	const split = (name: string) => {
		const at = query ? name.toLowerCase().indexOf(query.trim().toLowerCase()) : -1;
		if (at === -1) return { head: name, match: '', tail: '' };
		const end = at + query.trim().length;
		return { head: name.slice(0, at), match: name.slice(at, end), tail: name.slice(end) };
	};

	$effect(() => {
		list.querySelector(`#${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
	});
</script>

<div bind:this={list} {id} role="listbox" aria-label={source.list} class="max-h-[inherit] overflow-y-auto overscroll-contain p-1.5">
	{#each suggestions as suggestion, i (suggestion.kind === 'existing' ? suggestion.item.id : 'create')}
		<button
			type="button"
			id="{id}-{i}"
			role="option"
			aria-selected={i === active}
			class="menu-item"
			data-active={i === active}
			onmousedown={(e) => e.preventDefault()}
			onclick={() => onpick(suggestion)}
		>
			{#if suggestion.kind === 'existing'}
				{@const parts = split(suggestion.item.name)}
				<source.icon size={15} class="shrink-0 text-muted" />
				<span class="truncate">{parts.head}<strong class="font-semibold">{parts.match}</strong>{parts.tail}</span>
			{:else}
				<Plus size={15} class="shrink-0 text-accent" />
				<span class="truncate">Create {source.noun} “{suggestion.name}”</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.menu-item[data-active='true'] {
		background: color-mix(in srgb, currentColor 7%, transparent);
	}
</style>
