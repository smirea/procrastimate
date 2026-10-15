<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Check from 'phosphor-svelte/lib/Check';
	import LinkSimple from 'phosphor-svelte/lib/LinkSimple';
	import UserPlus from 'phosphor-svelte/lib/UserPlus';
	import type { Person, ShareTarget, ShareView } from 'shared/sharing.ts';
	import type { Role } from 'shared/values.ts';
	import PersonName from './PersonName.svelte';
	import { api } from '../api.ts';
	import { store } from '../store.svelte.ts';
	import { sheets, motion } from '../ui.svelte.ts';

	let { target, name }: { target: ShareTarget; name: string } = $props();

	const SEARCH_DELAY = 200;

	let shares = $state<ShareView[]>([]);
	let loaded = $state(false);
	let error = $state('');
	let copied = $state(false);
	let query = $state('');
	let role = $state<Role>('edit');
	let found = $state<Person[]>([]);
	let searching = $state(false);

	const link = $derived(shares.find((s) => s.grantee === null));
	const people = $derived(shares.filter((s): s is ShareView & { grantee: Person } => s.grantee !== null));
	const suggestions = $derived(found.filter((p) => !people.some((s) => s.grantee.id === p.id)));

	onMount(async () => {
		const list = await api.shares.list().catch(() => null);
		loaded = true;
		if (!list) {
			error = 'Sharing needs a connection';
			return;
		}
		shares = list.shares.filter((s) => s.target.kind === target.kind && s.target.id === target.id);
		store.rememberPeople(people.map((s) => s.grantee));
	});

	$effect(() => {
		const q = query.trim();
		if (!q) {
			found = [];
			return;
		}
		searching = true;
		const timer = setTimeout(async () => {
			const result = await api.people.search({ query: { q } }).catch(() => null);
			if (query.trim() !== q) return;
			searching = false;
			found = result?.people ?? [];
		}, SEARCH_DELAY);
		return () => clearTimeout(timer);
	});

	async function copyLink() {
		error = '';
		let url = link?.url;
		if (!url) {
			const share = await api.shares.create({ target, audience: { kind: 'link' } }).catch(() => null);
			if (!share?.url) {
				error = 'Could not create the link';
				return;
			}
			shares = [...shares, share];
			url = share.url;
		}
		await navigator.clipboard?.writeText(url).catch(() => undefined);
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}

	async function add(person: Person) {
		error = '';
		const share = await api.shares
			.create({ target, audience: { kind: 'user', userId: person.id, role } })
			.catch(() => null);
		if (!share) {
			error = `Could not share with ${person.name}`;
			return;
		}
		shares = [...shares.filter((s) => s.grantee?.id !== person.id), share];
		store.rememberPeople([person]);
		query = '';
	}

	async function remove(share: ShareView) {
		error = '';
		const before = shares;
		shares = shares.filter((s) => s.id !== share.id);
		const done = await api.shares.delete({ query: { id: share.id } }).catch(() => null);
		if (!done) {
			shares = before;
			error = 'Could not stop sharing';
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && suggestions[0]) {
			event.preventDefault();
			void add(suggestions[0]);
		}
	}
</script>

<div class="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" transition:fade={motion({ duration: 160 })} onclick={() => sheets.close()} aria-hidden="true"></div>
<div
	role="dialog"
	aria-label="Share"
	class="glass-strong sheet fixed z-50 flex flex-col gap-4 overflow-y-auto overscroll-contain p-3 md:top-[14vh] md:left-1/2 md:w-96 md:-translate-x-1/2 md:rounded-panel"
	transition:fly={motion({ y: '100%', duration: 300, easing: cubicOut, opacity: 1 })}
>
	<header class="flex items-center justify-between gap-2 pl-1.5">
		<div class="min-w-0">
			<h2 class="text-[17px] font-semibold">Share</h2>
			<p class="truncate text-[13px] text-muted">{name}</p>
		</div>
		<button type="button" class="icon-btn" aria-label="Close share" onclick={() => sheets.close()}>
			<X size={18} weight="bold" />
		</button>
	</header>

	<button type="button" class="btn btn-primary press w-full touch:h-11" disabled={!loaded} onclick={copyLink}>
		{#if copied}
			<span class="flex items-center gap-1.5" in:fly={motion({ y: 4, duration: 160 })}><Check size={15} weight="bold" />Link copied</span>
		{:else}
			<span class="flex items-center gap-1.5"><LinkSimple size={15} weight="bold" />Copy link</span>
		{/if}
	</button>

	<section class="flex flex-col gap-1.5" aria-label="Add people">
		<div class="flex items-center gap-1.5">
			<input
				class="field min-w-0 flex-1 touch:h-11 touch:text-base"
				type="search"
				aria-label="Email or name"
				placeholder="Add by email or name"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				bind:value={query}
				{onkeydown}
			/>
			<div class="role flex shrink-0 rounded-full p-0.5" role="radiogroup" aria-label="Access">
				{#each [['edit', 'Can edit'], ['view', 'Can view']] as const as [value, text] (value)}
					<button type="button" role="radio" aria-checked={role === value} class="role-option" onclick={() => (role = value)}>{text}</button>
				{/each}
			</div>
		</div>
		{#if query.trim()}
			<ul class="flex flex-col" aria-label="People found" transition:slide={motion({ duration: 160, easing: cubicOut })}>
				{#each suggestions as person (person.id)}
					<li>
						<button type="button" class="menu-item" onclick={() => add(person)}>
							<UserPlus size={15} class="shrink-0 text-muted" />
							<PersonName {person} class="flex-1" />
							<span class="text-[12px] text-faint">Add</span>
						</button>
					</li>
				{:else}
					<li class="px-2 py-1.5 text-[13px] text-muted">{searching ? 'Looking…' : 'No one found. Try their full email.'}</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if people.length || link}
		<section class="flex flex-col gap-1" aria-label="People with access" transition:slide={motion({ duration: 180, easing: cubicOut })}>
			<h3 class="heading px-1.5">Who has access</h3>
			<ul class="flex flex-col">
				{#each people as share (share.id)}
					<li class="flex items-center gap-2 rounded-xl px-1.5 py-1" animate:flip={motion({ duration: 200 })} transition:slide={motion({ duration: 180, easing: cubicOut })}>
						<PersonName person={share.grantee} class="flex-1 text-[14px]" />
						<span class="text-[12px] text-faint">{share.role === 'edit' ? 'Can edit' : 'Can view'}</span>
						<button type="button" class="icon-btn size-8 touch:size-11" aria-label={`Remove ${share.grantee.name}`} onclick={() => remove(share)}>
							<X size={14} />
						</button>
					</li>
				{/each}
				{#if link}
					<li class="flex items-center gap-2 rounded-xl px-1.5 py-1" transition:slide={motion({ duration: 180, easing: cubicOut })}>
						<LinkSimple size={15} class="shrink-0 text-muted" />
						<span class="min-w-0 flex-1">
							<span class="block text-[14px]">Anyone with the link</span>
							<span class="block truncate text-[12px] text-faint" aria-label="Link">{link.url}</span>
						</span>
						<button type="button" class="btn btn-quiet h-8 px-3 text-[12px] touch:h-11" onclick={() => remove(link)}>Stop sharing</button>
					</li>
				{/if}
			</ul>
		</section>
	{/if}

	{#if error}
		<p role="alert" class="px-1.5 text-[13px] text-[var(--tone-overdue)]" in:fly={motion({ y: 4, duration: 160 })}>{error}</p>
	{/if}
</div>

<style>
	.heading {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.025em;
		text-transform: uppercase;
		color: var(--color-faint);
	}

	.role {
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
	}

	.role-option {
		height: 2rem;
		padding: 0 0.625rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		color: var(--color-muted);
		transition:
			background 160ms var(--ease-spring),
			color 160ms var(--ease-spring);
	}

	.role-option[aria-checked='true'] {
		background: var(--color-surface);
		color: var(--color-ink);
		box-shadow: 0 1px 3px color-mix(in srgb, var(--glass-shadow) 50%, transparent);
	}

	@media (pointer: coarse) {
		.role-option {
			height: 2.5rem;
		}
	}
</style>
