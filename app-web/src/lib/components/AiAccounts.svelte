<script lang="ts">
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Check from 'phosphor-svelte/lib/Check';
	import Copy from 'phosphor-svelte/lib/Copy';
	import Key from 'phosphor-svelte/lib/Key';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Robot from 'phosphor-svelte/lib/Robot';
	import Trash from 'phosphor-svelte/lib/Trash';
	import type { Person } from 'shared/sharing.ts';
	import PersonName from './PersonName.svelte';
	import { api } from '../api.ts';
	import { store } from '../store.svelte.ts';
	import { motion } from '../ui.svelte.ts';

	let accounts = $state<Person[]>([]);
	let loaded = $state(false);
	let name = $state('');
	let error = $state('');
	/** The secret is only ever in this response, so it lives here until the popover closes. */
	let token = $state<{ accountId: string; value: string; prompt: string } | null>(null);
	let copied = $state<'token' | 'prompt' | null>(null);
	let confirming = $state<string | null>(null);

	onMount(async () => {
		const result = await api.ai.list().catch(() => null);
		loaded = true;
		if (!result) return;
		accounts = result.accounts;
		store.rememberPeople(accounts);
	});

	async function create(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		error = '';
		const account = await api.ai.create({ name: trimmed }).catch(() => null);
		if (!account) {
			error = 'Could not create the AI account';
			return;
		}
		accounts = [...accounts, account];
		store.rememberPeople([account]);
		name = '';
	}

	async function generate(account: Person) {
		error = '';
		const created = await api.tokens.create({ aiUserId: account.id, name: account.name }).catch(() => null);
		if (!created) {
			error = 'Could not make a token';
			return;
		}
		token = { accountId: account.id, value: created.token, prompt: created.prompt };
		copied = null;
	}

	async function copy(what: 'token' | 'prompt') {
		if (!token) return;
		await navigator.clipboard?.writeText(what === 'token' ? token.value : token.prompt).catch(() => undefined);
		copied = what;
	}

	async function remove(account: Person) {
		error = '';
		confirming = null;
		const before = accounts;
		accounts = accounts.filter((a) => a.id !== account.id);
		if (token?.accountId === account.id) token = null;
		const done = await api.ai.delete({ query: { id: account.id } }).catch(() => null);
		if (!done) {
			accounts = before;
			error = `Could not delete ${account.name}`;
		}
	}
</script>

<section class="flex flex-col gap-1.5" aria-label="AI accounts">
	<h3 class="heading">AI accounts</h3>
	{#if loaded && accounts.length === 0}
		<p class="px-1.5 text-[12px] text-muted">An AI account can read and edit all your tasks with its own token.</p>
	{/if}
	<ul class="flex flex-col">
		{#each accounts as account (account.id)}
			<li class="flex flex-col" animate:flip={motion({ duration: 200 })} transition:slide={motion({ duration: 180, easing: cubicOut })}>
				<div class="flex items-center gap-1 px-1.5 py-0.5">
					<PersonName person={account} class="flex-1 text-[14px]" />
					{#if confirming === account.id}
						<button type="button" class="btn press h-8 bg-[var(--tone-overdue)] px-3 text-[12px] text-on-accent touch:h-11" onclick={() => remove(account)}>Delete</button>
						<button type="button" class="btn btn-quiet h-8 px-3 text-[12px] touch:h-11" onclick={() => (confirming = null)}>Cancel</button>
					{:else}
						<button type="button" class="btn btn-quiet h-8 px-3 text-[12px] touch:h-11" onclick={() => generate(account)}>
							<Key size={13} />Generate token
						</button>
						<button type="button" class="icon-btn size-8 touch:size-11" aria-label={`Delete ${account.name}`} onclick={() => (confirming = account.id)}>
							<Trash size={14} />
						</button>
					{/if}
				</div>
				{#if token?.accountId === account.id}
					<div class="token mx-1.5 mb-1 flex flex-col gap-1.5 rounded-xl p-2" transition:slide={motion({ duration: 200, easing: cubicOut })}>
						<p class="text-[12px] text-muted">Copy it now. It will not be shown again.</p>
						<div class="flex items-center gap-1.5">
							<code class="min-w-0 flex-1 truncate text-[12px] select-all" aria-label="Token">{token.value}</code>
							<button type="button" class="btn btn-quiet h-8 px-3 text-[12px] touch:h-11" onclick={() => copy('token')}>
								{#if copied === 'token'}<span class="flex items-center gap-1" in:fly={motion({ y: 3, duration: 140 })}><Check size={13} weight="bold" />Copied</span>{:else}<Copy size={13} />Copy{/if}
							</button>
						</div>
						<button type="button" class="btn btn-quiet h-8 self-start px-3 text-[12px] touch:h-11" title="Copies the token with where to find the API docs" onclick={() => copy('prompt')}>
							{#if copied === 'prompt'}<span class="flex items-center gap-1" in:fly={motion({ y: 3, duration: 140 })}><Check size={13} weight="bold" />Copied</span>{:else}<Robot size={13} />Copy prompt for your AI{/if}
						</button>
					</div>
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
	{#if error}
		<p role="alert" class="px-1.5 text-[13px] text-[var(--tone-overdue)]">{error}</p>
	{/if}
</section>

<style>
	.heading {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.025em;
		text-transform: uppercase;
		color: var(--color-faint);
	}

	.token {
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}
</style>
