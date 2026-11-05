<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { page } from '$app/state';
	import LinkSimple from 'phosphor-svelte/lib/LinkSimple';
	import type { SharedView } from 'shared/sharing.ts';
	import { sortTasks } from 'shared/store.ts';
	import { openTasks } from 'shared/triggers.ts';
	import { projectGroups } from 'shared/views.ts';
	import TaskList from '#lib/components/TaskList.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import SharedTaskDetails from '#lib/components/SharedTaskDetails.svelte';
	import PersonName from '#lib/components/PersonName.svelte';
	import PendingCount from '#lib/components/PendingCount.svelte';
	import SectionBadge from '#lib/components/SectionBadge.svelte';
	import { api, isNotFound } from '#lib/api.ts';
	import { provideReadOnlyLookup } from '#lib/lookup.ts';
	import { motion, type Arrival } from '#lib/ui.svelte.ts';

	type State = { kind: 'loading' } | { kind: 'gone' } | { kind: 'failed' } | { kind: 'ready'; view: SharedView };

	let status = $state<State>({ kind: 'loading' });
	const view = $derived(status.kind === 'ready' ? status.view : null);

	/** The page's own details sheet: the app's sheets read the signed-in store, which never holds a link's tasks. */
	let opened = $state<{ id: string; arrival: Arrival } | null>(null);
	const openedTask = $derived(opened && view ? view.tasks.find((t) => t.id === opened?.id) : undefined);

	provideReadOnlyLookup(
		() => view ?? { tasks: [], projects: [], sections: [], labels: [] },
		(id, arrival = 'none') => (opened = { id, arrival }),
	);

	/** Open tasks whose parent is not shared with them, so subtasks show under their parent's progress instead. */
	const tasks = $derived.by(() => {
		if (!view) return [];
		const ids = new Set(view.tasks.map((t) => t.id));
		return sortTasks(openTasks(view.tasks).filter((t) => t.parentId === null || !ids.has(t.parentId)));
	});

	/** A shared project shows under its sections, like the project view. */
	const groups = $derived(
		view?.target.kind === 'project'
			? projectGroups(view.tasks, view.sections, view.target.id)
			: [{ section: null, tasks }],
	);

	const title = $derived.by(() => {
		if (!view) return 'Shared tasks';
		const { kind, id } = view.target;
		if (kind === 'project') return view.projects.find((p) => p.id === id)?.name ?? 'Shared project';
		if (kind === 'label') return view.labels.find((l) => l.id === id)?.name ?? 'Shared label';
		if (kind === 'task') return view.tasks.find((t) => t.id === id)?.title ?? 'Shared task';
		return `${view.owner.name}’s tasks`;
	});

	async function load() {
		status = { kind: 'loading' };
		try {
			status = { kind: 'ready', view: await api.shared.view({ query: { token: page.params.token ?? '' } }) };
		} catch (error) {
			status = { kind: isNotFound(error) ? 'gone' : 'failed' };
		}
	}

	onMount(load);
</script>

<svelte:head><title>{title} · ProcrastiMate</title></svelte:head>
<svelte:window onkeydown={(e) => e.key === 'Escape' && (opened = null)} />

<main class="mx-auto min-h-dvh max-w-3xl px-4 pt-10 pb-24 md:px-8">
	{#if status.kind === 'ready' && view}
		<section in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}>
			<header class="mb-5">
				<p class="mb-1 flex items-center gap-1 text-[12px] font-medium tracking-wide text-faint uppercase">
					<LinkSimple size={13} weight="bold" />Shared by <PersonName person={view.owner} />
				</p>
				<div class="flex min-w-0 items-baseline gap-2.5">
					<h1 class="truncate text-[26px] font-semibold tracking-tight">{title}</h1>
					<PendingCount open={groups.reduce((n, g) => n + g.tasks.length, 0)} class="text-[15px]" />
				</div>
			</header>
			{#each groups as group (group.section?.id ?? '')}
				{#if group.section}
					<div class="mt-6 mb-1 flex items-baseline justify-between gap-2 border-b border-ink/[0.07] pr-2 pb-1.5 pl-2">
						<h2 class="min-w-0 truncate text-[13px] font-semibold">{group.section.name}</h2>
						{#if group.section.counter === 'badge'}
							<SectionBadge rows={group.tasks} />
						{:else}
							<PendingCount open={group.tasks.length} class="text-[12px]" />
						{/if}
					</div>
				{/if}
				<TaskList tasks={group.tasks} showProject={view.target.kind !== 'project'} label={`${group.section?.name ?? title} tasks`} />
			{/each}
			{#if tasks.length === 0}
				<p class="mt-16 text-center text-[15px] font-medium" in:fade={motion({ duration: 240, delay: 120 })}>Nothing open here</p>
			{/if}
		</section>
	{:else if status.kind === 'gone'}
		<div class="mt-24 text-center" in:fade={motion({ duration: 240 })}>
			<p class="text-[15px] font-medium">This link no longer works</p>
			<p class="mt-1 text-[13px] text-muted">Its owner stopped sharing it, or it was copied wrong.</p>
		</div>
	{:else if status.kind === 'failed'}
		<div class="mt-24 text-center" in:fade={motion({ duration: 240 })}>
			<p class="text-[15px] font-medium">Couldn’t load this link</p>
			<p class="mt-1 text-[13px] text-muted">Check the connection and try again.</p>
			<button type="button" class="btn btn-primary mt-4" onclick={load}>Retry</button>
		</div>
	{/if}
</main>

{#if openedTask && opened}
	<Sheet label="Task details" desktop="slide" class="flex-col md:top-3 md:right-3 md:bottom-3 md:w-[min(440px,calc(100vw-1.5rem))] md:rounded-panel" onclose={() => (opened = null)}>
		{#key openedTask.id}
			<SharedTaskDetails task={openedTask} arrival={opened.arrival} onclose={() => (opened = null)} />
		{/key}
	</Sheet>
{/if}
