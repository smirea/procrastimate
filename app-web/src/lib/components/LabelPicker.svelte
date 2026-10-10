<script lang="ts">
	import Tag from 'phosphor-svelte/lib/Tag';
	import Check from 'phosphor-svelte/lib/Check';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { labelIdsOf, lastUsed, suggest, type Suggestion } from 'shared/name-search.ts';
	import type { Label } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import { store } from '../store.svelte.ts';
	import { mobile } from '../ui.svelte.ts';

	let { labelIds, onchange }: { labelIds: string[]; onchange: (labelIds: string[]) => void } = $props();

	let query = $state('');
	let active = $state(0);

	const chosen = $derived(store.labelsOf({ labelIds }));
	const options = $derived(suggest(store.labels, lastUsed(store.tasks, labelIdsOf), query));

	function choose(option: Suggestion<Label>) {
		if (option.kind === 'create') {
			onchange([...labelIds, store.addLabel(option.name).id]);
			query = '';
			return;
		}
		const id = option.item.id;
		onchange(labelIds.includes(id) ? labelIds.filter((l) => l !== id) : [...labelIds, id]);
	}

	function onkeydown(event: KeyboardEvent) {
		const count = options.length;
		if (!count) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			choose(options[active]!);
		}
	}

	$effect(() => {
		void query;
		active = 0;
	});

	/** A phone keeps its keyboard down until the field is tapped, so the list stays in view. */
	const focusUnlessPhone = (node: HTMLInputElement) => {
		if (!mobile.current) node.focus();
	};
</script>

<Popover label="Labels">
	{#snippet trigger({ toggle })}
		<button
			type="button"
			class="chip max-w-64"
			data-active={chosen.length > 0}
			aria-label={chosen.length ? `Labels ${chosen.map((l) => l.name).join(', ')}` : 'Add labels'}
			onclick={() => {
				query = '';
				toggle();
			}}
		>
			<Tag size={15} weight={chosen.length ? 'fill' : 'regular'} class="shrink-0 text-[var(--tone-label)]" />
			<span class="truncate">{chosen.length ? chosen.map((l) => l.name).join(', ') : 'Labels'}</span>
		</button>
	{/snippet}
	{#snippet children()}
		<div class="w-64">
			<div class="px-1 pt-0.5 pb-1.5">
				<input
					use:focusUnlessPhone
					class="field w-full"
					aria-label="Find or create a label"
					placeholder="Find or create a label"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					bind:value={query}
					{onkeydown}
				/>
			</div>
			{#each options as option, i (option.kind === 'existing' ? option.item.id : 'create')}
				{@const checked = option.kind === 'existing' && labelIds.includes(option.item.id)}
				<button
					type="button"
					role="menuitemcheckbox"
					aria-checked={checked}
					class="menu-item"
					data-active={i === active && query !== ''}
					onclick={() => choose(option)}
				>
					{#if option.kind === 'existing'}
						<Tag size={15} weight={checked ? 'fill' : 'regular'} class="shrink-0 text-[var(--tone-label)]" />
						<span class="flex-1 truncate">{option.item.name}</span>
						{#if checked}<span class="grid" transition:scale={{ start: 0.5, duration: 160, easing: cubicOut }}><Check size={14} class="text-accent" /></span>{/if}
					{:else}
						<Plus size={15} class="shrink-0 text-accent" />
						<span class="flex-1 truncate">Create label “{option.name}”</span>
					{/if}
				</button>
			{:else}
				<p class="px-2 py-1.5 text-[13px] text-muted">Type a name to create your first label.</p>
			{/each}
		</div>
	{/snippet}
</Popover>

<style>
	.menu-item[data-active='true'] {
		background: color-mix(in srgb, currentColor 7%, transparent);
	}
</style>
