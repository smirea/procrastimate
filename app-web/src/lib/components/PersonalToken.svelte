<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import Key from 'phosphor-svelte/lib/Key';
	import Trash from 'phosphor-svelte/lib/Trash';
	import TokenReveal from './TokenReveal.svelte';
	import { api } from '../api.ts';
	import { session } from '../session.svelte.ts';
	import { motion, toasts } from '../ui.svelte.ts';

	/** Ids of the tokens that act as the user, read once, so Revoke shows only when there is one to revoke. */
	let ids = $state<string[]>([]);
	/** The secret is only ever in the create response, so it lives here until Settings closes. Null while it is made. */
	let made = $state.raw<{ value: string; prompt: string } | null | undefined>(undefined);
	let confirming = $state(false);
	/** A newer generate or a revoke supersedes a token still being made. */
	let attempt = 0;

	onMount(async () => {
		const result = await api.tokens.list().catch(() => null);
		if (result) ids = result.tokens.filter((token) => token.aiUserId === session.userId).map((token) => token.id);
	});

	async function generate() {
		const owner = session.userId;
		if (!owner) return;
		const mine = ++attempt;
		made = null;
		const created = await api.tokens.create({ aiUserId: owner, name: 'Personal' }).catch(() => null);
		if (created) ids = [...ids, created.id];
		if (mine !== attempt) return;
		if (!created) {
			made = undefined;
			toasts.show('Could not make a token');
			return;
		}
		made = { value: created.token, prompt: created.prompt };
	}

	async function revoke() {
		confirming = false;
		attempt++;
		const revoked = ids;
		ids = [];
		made = undefined;
		const results = await Promise.allSettled(revoked.map((id) => api.tokens.delete({ query: { id } })));
		const kept = revoked.filter((_, index) => results[index]?.status === 'rejected');
		if (!kept.length) return;
		ids = [...kept, ...ids];
		toasts.show('Could not revoke your tokens');
	}
</script>

<section class="flex flex-col gap-1.5" aria-label="Personal token">
	<h3 class="heading">Personal token</h3>
	<p class="px-1.5 text-[12px] text-muted">Acts as you through the API, for your own scripts and launchers. What it adds is yours.</p>
	<div class="flex items-center gap-1 px-1.5 py-0.5">
		{#if confirming}
			<button type="button" class="btn press h-8 bg-[var(--tone-overdue)] px-3 text-[12px] text-on-accent touch:h-11" onclick={revoke}>Revoke all</button>
			<button type="button" class="btn btn-quiet h-8 px-3 text-[12px] touch:h-11" onclick={() => (confirming = false)}>Cancel</button>
		{:else}
			<button type="button" class="btn btn-quiet -ml-1.5 h-8 px-3 text-[12px] touch:h-11" onclick={generate}>
				<Key size={13} />Generate token
			</button>
			<span class="flex-1"></span>
			{#if ids.length}
				<button type="button" class="icon-btn size-8 touch:size-11" aria-label="Revoke personal tokens" title="Revoke personal tokens" onclick={() => (confirming = true)} in:fly={motion({ x: 4, duration: 140 })}>
					<Trash size={14} />
				</button>
			{/if}
		{/if}
	</div>
	{#if made !== undefined}
		<TokenReveal {made} />
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
</style>
