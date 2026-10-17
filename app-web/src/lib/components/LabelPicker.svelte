<script lang="ts">
	import Tag from 'phosphor-svelte/lib/Tag';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import Check from 'phosphor-svelte/lib/Check';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { labelIdsOf, lastUsed, suggest, type Suggestion } from 'shared/name-search.ts';
	import type { Label } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import { store } from '../store.svelte.ts';
	import { labelStyle } from '../label-colors.ts';
	import { mobile, motion } from '../ui.svelte.ts';

	/** A shared task passes its space's labels, and cannot create one: labels made here are always the user's own. */
	let {
		labelIds,
		onchange,
		labels,
		canCreate = true,
		open = $bindable(false),
	}: {
		labelIds: string[];
		onchange: (labelIds: string[]) => void;
		labels?: readonly Label[];
		canCreate?: boolean;
		open?: boolean;
	} = $props();

	let query = $state('');
	let active = $state(0);

	const chosen = $derived(store.labelsOf({ labelIds }));
	const options = $derived(
		suggest(labels ?? store.labels, lastUsed(store.tasks, labelIdsOf), query).filter((o) => canCreate || o.kind !== 'create'),
	);

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

	$effect(() => {
		if (open) query = '';
	});

</script>

<Popover label="Labels" bind:open>
	{#snippet trigger({ toggle })}
		<button
			type="button"
			class="chip max-w-64"
			data-active={chosen.length > 0}
			style={chosen[0] ? labelStyle(chosen[0].color) : undefined}
			aria-label={chosen.length ? `Labels ${chosen.map((l) => l.name).join(', ')}` : 'Add labels'}
			onclick={toggle}
		>
			<Tag size={15} weight={chosen.length ? 'fill' : 'regular'} class="shrink-0 {chosen.length ? 'text-[var(--label-tone)]' : 'text-[var(--tone-label)]'}" />
			<span class="truncate">{chosen.length ? chosen.map((l) => l.name).join(', ') : 'Labels'}</span>
		</button>
	{/snippet}
	{#snippet children()}
		<div class="w-64">
			<div class="px-1 pt-0.5 pb-1.5">
				<!-- A phone keeps its keyboard down until the field is tapped, so the list stays in view. -->
				<input
					data-autofocus={mobile.current ? undefined : ''}
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
						{@const Icon = option.item.place ? MapPin : Tag}
						<Icon size={15} weight={checked ? 'fill' : 'regular'} class="shrink-0 text-[var(--label-tone)]" style={labelStyle(option.item.color)} />
						<span class="flex-1 truncate">{option.item.name}</span>
						{#if checked}<span class="grid" transition:scale={motion({ start: 0.5, duration: 160, easing: cubicOut })}><Check size={14} class="text-accent" /></span>{/if}
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
