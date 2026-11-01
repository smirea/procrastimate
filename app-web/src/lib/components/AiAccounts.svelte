<script lang="ts">
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Key from 'phosphor-svelte/lib/Key';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Trash from 'phosphor-svelte/lib/Trash';
	import type { Person } from 'shared/sharing.ts';
	import PersonName from './PersonName.svelte';
	import TokenReveal from './TokenReveal.svelte';
	import { api } from '../api.ts';
	import { OptimisticList, type Row } from '../optimistic.svelte.ts';
	import { session } from '../session.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { motion, toasts } from '../ui.svelte.ts';

	const accounts = new OptimisticList<Person>((account) => account.id);
	let loaded = $state(false);
	let name = $state('');
	/** The secret is only ever in this response, so it lives here until the popover closes. Null while it is made. */
	let token = $state.raw<{ key: string; made: { value: string; prompt: string } | null } | null>(null);
	let confirming = $state<string | null>(null);

	onMount(async () => {
		const result = await api.ai.list().catch(() => null);
		loaded = true;
		if (!result) return;
		accounts.load(result.accounts);
		store.rememberPeople(result.accounts);
	});

	function create(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		name = '';
		const placeholder: Person = { id: '', name: trimmed, kind: 'ai', ownerId: session.userId };
		accounts.add(
			placeholder,
			async () => {
				const account = await api.ai.create({ name: trimmed });
				store.rememberPeople([account]);
				return account;
			},
			`Could not create ${trimmed}`,
		);
	}

	async function generate(row: Row<Person>) {
		const pending = { key: row.key, made: null };
		token = pending;
		const account = await row.saved;
		const created = account
			? await api.tokens.create({ aiUserId: account.id, name: account.name }).catch(() => null)
			: null;
		if (token !== pending) return;
		if (created) {
			token = { key: row.key, made: { value: created.token, prompt: created.prompt } };
		} else {
			token = null;
			if (account) toasts.show('Could not make a token');
		}
	}

	function remove(row: Row<Person>) {
		confirming = null;
		if (token?.key === row.key) token = null;
		void accounts.remove(
			row,
			(account) => api.ai.delete({ query: { id: account.id } }),
			`Could not delete ${row.value.name}`,
		);
	}
</script>

<section class="flex flex-col gap-1.5" aria-label="AI accounts">
	<h3 class="heading">AI accounts</h3>
	{#if loaded && accounts.rows.length === 0}
		<p class="px-1.5 text-[12px] text-muted">An AI account can read and edit all your tasks with its own token.</p>
	{/if}
	<ul class="flex flex-col">
		{#each accounts.rows as row (row.key)}
			{@const account = row.value}
			<li class="flex flex-col" animate:flip={motion({ duration: 200 })} transition:slide={motion({ duration: 180, easing: cubicOut })}>
				<div class="flex items-center gap-1 px-1.5 py-0.5">
					<PersonName person={account} class="flex-1 text-[14px]" />
					{#if confirming === row.key}
						<button type="button" class="btn press h-8 bg-[var(--tone-overdue)] px-3 text-[12px] text-on-accent touch:h-11" onclick={() => remove(row)}>Delete</button>
						<button type="button" class="btn btn-quiet h-8 px-3 text-[12px] touch:h-11" onclick={() => (confirming = null)}>Cancel</button>
					{:else}
						<button type="button" class="btn btn-quiet h-8 px-3 text-[12px] touch:h-11" onclick={() => generate(row)}>
							<Key size={13} />Generate token
						</button>
						<button type="button" class="icon-btn size-8 touch:size-11" aria-label={`Delete ${account.name}`} onclick={() => (confirming = row.key)}>
							<Trash size={14} />
						</button>
					{/if}
				</div>
				{#if token?.key === row.key}
					<TokenReveal made={token.made} />
				{/if}
			</li>
		{/each}
	</ul>
	<form class="flex items-center gap-1.5" onsubmit={create}>
		<input class="field min-w-0 flex-1 touch:h-11 touch:text-base" aria-label="AI account name" placeholder="New AI account" bind:value={name} />
		<button type="submit" class="icon-btn touch:size-11" aria-label="Create AI account" disabled={!name.trim()}>
			<Plus size={16} weight="bold" />
		</button>
	</form>
</section>

<style>
	.heading {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.025em;
		text-transform: uppercase;
		color: var(--color-faint);
	}
</style>
