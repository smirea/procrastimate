<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { page } from '$app/state';
	import LinkSimple from 'phosphor-svelte/lib/LinkSimple';
	import type { SharedView } from 'shared/sharing.ts';
	import { sortTasks } from 'shared/store.ts';
	import TaskList from '#lib/components/TaskList.svelte';
	import PersonName from '#lib/components/PersonName.svelte';
	import { api } from '#lib/api.ts';
	import { provideReadOnlyLookup } from '#lib/lookup.ts';
	import { motion } from '#lib/ui.svelte.ts';

	type State = { kind: 'loading' } | { kind: 'gone' } | { kind: 'ready'; view: SharedView };

	let state = $state<State>({ kind: 'loading' });
	const view = $derived(state.kind === 'ready' ? state.view : null);

	provideReadOnlyLookup(() => view ?? { tasks: [], projects: [], labels: [] });

	/** Open tasks whose parent is not shared with them, so subtasks show under their parent's progress instead. */
	const tasks = $derived.by(() => {
		if (!view) return [];
		const ids = new Set(view.tasks.map((t) => t.id));
		return sortTasks(view.tasks.filter((t) => t.completedAt === null && (t.parentId === null || !ids.has(t.parentId))));
	});

	const title = $derived.by(() => {
		if (!view) return 'Shared tasks';
		const { kind, id } = view.target;
		if (kind === 'project') return view.projects.find((p) => p.id === id)?.name ?? 'Shared project';
		if (kind === 'label') return view.labels.find((l) => l.id === id)?.name ?? 'Shared label';
		if (kind === 'task') return view.tasks.find((t) => t.id === id)?.title ?? 'Shared task';
		return `${view.owner.name}’s tasks`;
	});

	onMount(async () => {
		const result = await api.shared.view({ query: { token: page.params.token ?? '' } }).catch(() => null);
		state = result ? { kind: 'ready', view: result } : { kind: 'gone' };
	});
</script>

<svelte:head><title>{title} · ProcrastiMate</title></svelte:head>

<main class="mx-auto min-h-dvh max-w-3xl px-4 pt-10 pb-24 md:px-8">
	{#if state.kind === 'ready' && view}
		<section in:fly={motion({ y: 6, duration: 220, easing: cubicOut })}>
			<header class="mb-5">
				<p class="mb-1 flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-faint uppercase">
					<LinkSimple size={13} weight="bold" />Shared by <PersonName person={view.owner} />
				</p>
				<h1 class="truncate text-[26px] font-semibold tracking-tight">{title}</h1>
			</header>
			<TaskList {tasks} showProject={view.target.kind !== 'project'} label={`${title} tasks`} />
			{#if tasks.length === 0}
				<p class="mt-16 text-center text-[15px] font-medium" in:fade={motion({ duration: 240, delay: 120 })}>Nothing open here</p>
			{/if}
		</section>
	{:else if state.kind === 'gone'}
		<div class="mt-24 text-center" in:fade={motion({ duration: 240 })}>
			<p class="text-[15px] font-medium">This link no longer works</p>
			<p class="mt-1 text-[13px] text-muted">Its owner stopped sharing it, or it was copied wrong.</p>
		</div>
	{/if}
</main>
