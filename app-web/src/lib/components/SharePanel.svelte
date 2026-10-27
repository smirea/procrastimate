<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import X from 'phosphor-svelte/lib/X';
	import Check from 'phosphor-svelte/lib/Check';
	import LinkSimple from 'phosphor-svelte/lib/LinkSimple';
	import UserPlus from 'phosphor-svelte/lib/UserPlus';
	import { type Person, type ShareAudience, type ShareTarget, type ShareView } from 'shared/sharing.ts';
	import type { Role } from 'shared/values.ts';
	import PersonName from './PersonName.svelte';
	import { api } from '../api.ts';
	import { OptimisticList, type Row } from '../optimistic.svelte.ts';
	import { shareSuggestions } from '../share-suggestions.ts';
	import { session } from '../session.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { settled } from '../sync.svelte.ts';
	import { sheets, motion } from '../ui.svelte.ts';

	let { target, name }: { target: ShareTarget; name: string } = $props();

	const SEARCH_DELAY = 200;

	const shares = new OptimisticList<ShareView>((share) => share.id);
	let loaded = $state(false);
	let error = $state('');
	let copied = $state(false);
	let query = $state('');
	let role = $state<Role>('edit');
	let found = $state<{ q: string; people: Person[] } | null>(null);

	const link = $derived(shares.rows.find((row) => row.value.grantee === null));
	const people = $derived(
		shares.rows.filter((row): row is Row<ShareView & { grantee: Person }> => row.value.grantee !== null),
	);
	const suggestions = $derived(
		shareSuggestions({
			q: query.trim(),
			me: session.userId,
			known: store.people,
			found,
			granted: people.map((row) => row.value.grantee.id),
		}),
	);
	const searching = $derived(found?.q !== query.trim());

	onMount(async () => {
		const list = await api.shares.list().catch(() => null);
		loaded = true;
		if (!list) {
			error = 'Sharing needs a connection';
			return;
		}
		shares.load(list.shares.filter((s) => s.target.kind === target.kind && s.target.id === target.id));
		store.rememberPeople(people.map((row) => row.value.grantee));
	});

	$effect(() => {
		const q = query.trim();
		if (!q) return;
		const timer = setTimeout(async () => {
			const result = await api.people.search({ query: { q } }).catch(() => null);
			found = { q, people: result?.people ?? [] };
		}, SEARCH_DELAY);
		return () => clearTimeout(timer);
	});

	/** The server shares only what it holds, so a project made a moment ago has to arrive before its share. */
	async function create(audience: ShareAudience) {
		await settled();
		return api.shares.create({ target, audience });
	}

	const placeholder = (grantee: Person | null, role: Role): ShareView => ({
		id: '',
		target,
		grantee,
		role,
		createdAt: Date.now(),
		url: null,
	});

	/**
	 * Safari only writes the clipboard inside the tap, so a link the server has not made yet goes in as a promise.
	 * Browsers without promised clipboard items write it once it arrives.
	 */
	async function writeClipboard(url: Promise<string | null>) {
		if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
			const text = url.then((value) => {
				if (value === null) throw new Error('No link');
				return new Blob([value], { type: 'text/plain' });
			});
			// The browser may refuse the write before the link settles, and then nothing else observes this promise.
			text.catch(() => undefined);
			await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]).catch(() => undefined);
		} else {
			const value = await url;
			if (value !== null) await navigator.clipboard?.writeText(value).catch(() => undefined);
		}
		return (await url) !== null;
	}

	async function copyLink() {
		const row = link ?? shares.add(placeholder(null, 'view'), () => create({ kind: 'link' }), 'Could not create the link');
		const url = row.saved.then((share) => (shares.rows.some((r) => r.key === row.key) ? (share?.url ?? null) : null));
		if (!(await writeClipboard(url))) return;
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}

	function add(person: Person) {
		query = '';
		store.rememberPeople([person]);
		shares.add(
			placeholder(person, role),
			() => create({ kind: 'user', userId: person.id, role }),
			`Could not share with ${person.name}`,
		);
	}

	function remove(row: Row<ShareView>) {
		void shares.remove(row, (share) => api.shares.delete({ query: { id: share.id } }), 'Could not stop sharing');
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && suggestions[0]) {
			event.preventDefault();
			add(suggestions[0]);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			if (query) query = '';
			else sheets.close();
		}
	}
</script>

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
			enterkeyhint="done"
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
			{#each people as row (row.key)}
				{@const share = row.value}
				<li class="flex items-center gap-2 rounded-xl px-1.5 py-1" animate:flip={motion({ duration: 200 })} transition:slide={motion({ duration: 180, easing: cubicOut })}>
					<PersonName person={share.grantee} class="flex-1 text-[14px]" />
					<span class="text-[12px] text-faint">{share.role === 'edit' ? 'Can edit' : 'Can view'}</span>
					<button type="button" class="icon-btn size-8 touch:size-11" aria-label={`Remove ${share.grantee.name}`} onclick={() => remove(row)}>
						<X size={14} />
					</button>
				</li>
			{/each}
			{#if link}
				<li class="flex items-center gap-2 rounded-xl px-1.5 py-1" transition:slide={motion({ duration: 180, easing: cubicOut })}>
					<LinkSimple size={15} class="shrink-0 text-muted" />
					<span class="min-w-0 flex-1">
						<span class="block text-[14px]">Anyone with the link</span>
						{#if link.value.url}
							<span class="block truncate text-[12px] text-faint" aria-label="Link" in:fade={motion({ duration: 140 })}>{link.value.url}</span>
						{:else}
							<span class="pending-value mt-1 h-3 w-40" role="status" aria-label="Making the link"></span>
						{/if}
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

	@media (max-width: 767px), (pointer: coarse) {
		.role-option {
			height: 2.75rem;
		}
	}
</style>
