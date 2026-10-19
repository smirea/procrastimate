<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import Flag from 'phosphor-svelte/lib/Flag';
	import FunnelSimple from 'phosphor-svelte/lib/FunnelSimple';
	import type { Snippet } from 'svelte';
	import type { Task } from 'shared/task.ts';
	import { filterActive, filterOptions, NO_FILTER, toggleGroup, toggleOption, type FilterGroup } from 'shared/list-filters.ts';
	import Popover from './Popover.svelte';
	import PersonName from './PersonName.svelte';
	import { listFilters } from '../list-filters.svelte.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { session } from '../session.svelte.ts';
	import { store } from '../store.svelte.ts';

	/** `tasks` are the list's open rows before filtering, which the counts read. */
	let { list, tasks }: { list: string; tasks: Task[] } = $props();

	const me = $derived(session.userId ?? '');
	const filter = $derived(listFilters.get(list));
	const active = $derived(filterActive(filter));
	const options = $derived(filterOptions(tasks, filter, me));
	const set = (next: typeof filter) => listFilters.set(list, next);
</script>

{#snippet check(on: boolean)}
	<span class="grid size-4 shrink-0 place-items-center text-accent">{#if on}<Check size={14} weight="bold" />{/if}</span>
{/snippet}

{#snippet group(name: FilterGroup, heading: string, rows: Snippet)}
	<div role="group" aria-label={heading} class="not-first:mt-1 not-first:border-t not-first:border-ink/5 not-first:pt-1">
		<button
			type="button"
			role="menuitemcheckbox"
			aria-checked={filter[name] !== null}
			class="menu-item text-[12px] font-medium text-muted!"
			onclick={() => set(toggleGroup(filter, name, options))}
		>
			{@render check(filter[name] !== null)}{heading}
		</button>
		{@render rows()}
	</div>
{/snippet}

{#if options.people.length || options.priorities.length || active}
	<Popover label="Filters">
		{#snippet trigger({ toggle })}
			<button
				type="button"
				class="icon-btn touch:size-11 {active ? 'bg-accent/12! text-accent!' : ''}"
				aria-label="Filters"
				aria-pressed={active}
				onclick={toggle}
			>
				<FunnelSimple size={19} weight={active ? 'fill' : 'regular'} />
			</button>
		{/snippet}
		{#snippet children()}
			<div class="w-60">
				{#if options.people.length}
					{#snippet people()}
						{#each options.people as option (option.value)}
							<button
								type="button"
								role="menuitemcheckbox"
								aria-checked={option.selected}
								class="menu-item"
								onclick={() => set(toggleOption(filter, 'people', option.value))}
							>
								{@render check(option.selected)}
								<PersonName person={store.person(option.value) ?? { id: option.value, name: 'Someone', kind: 'human', ownerId: null }} you class="flex-1" />
								<span class="text-[12px] text-muted tabular-nums">{option.count}</span>
							</button>
						{/each}
					{/snippet}
					{@render group('people', 'Created by', people)}
				{/if}
				{#if options.priorities.length}
					{#snippet priorities()}
						{#each options.priorities as option (option.value)}
							<button
								type="button"
								role="menuitemcheckbox"
								aria-checked={option.selected}
								class="menu-item"
								onclick={() => set(toggleOption(filter, 'priorities', option.value))}
							>
								{@render check(option.selected)}
								<Flag size={15} weight={option.value !== 4 ? 'fill' : 'regular'} color={PRIORITIES[option.value].tone} />
								<span class="flex-1">{PRIORITIES[option.value].label}</span>
								<span class="text-[12px] text-muted tabular-nums">{option.count}</span>
							</button>
						{/each}
					{/snippet}
					{@render group('priorities', 'Priority', priorities)}
				{/if}
				{#if active}
					<div class="mt-1 border-t border-ink/5 pt-1">
						<button type="button" class="menu-item" onclick={() => set(NO_FILTER)}>Clear filters</button>
					</div>
				{/if}
			</div>
		{/snippet}
	</Popover>
{/if}
