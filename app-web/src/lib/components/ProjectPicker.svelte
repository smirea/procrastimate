<script lang="ts">
	import Tray from 'phosphor-svelte/lib/Tray';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Rows from 'phosphor-svelte/lib/Rows';
	import Check from 'phosphor-svelte/lib/Check';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { projectsInOrder, sectionsOf } from 'shared/store.ts';
	import type { Project, Section } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import { store } from '../store.svelte.ts';

	type Place = { projectId: string | null; sectionId: string | null };

	/** A shared task passes its space's projects and sections, and its "Inbox" is the owner's, since nothing moves between spaces. */
	let {
		projectId,
		sectionId = null,
		onchange,
		align = 'start',
		projects,
		sections,
		canCreate = true,
	}: {
		projectId: string | null;
		sectionId?: string | null;
		onchange: (place: Place) => void;
		align?: 'start' | 'end';
		projects?: readonly Project[];
		sections?: readonly Section[];
		canCreate?: boolean;
	} = $props();

	const project = $derived(store.project(projectId));
	const section = $derived(store.section(sectionId));
	const allSections = $derived(sections ?? store.sections);
	const options = $derived([
		{ place: { projectId: null, sectionId: null }, name: 'Inbox', nested: false },
		...(projects ? projectsInOrder(projects) : store.projects).flatMap((p) => [
			{ place: { projectId: p.id, sectionId: null }, name: p.name, nested: false },
			...sectionsOf(allSections, p.id).map((s) => ({ place: { projectId: p.id, sectionId: s.id }, name: s.name, nested: true })),
		]),
	]);
	const label = $derived(project ? (section ? `${project.name} / ${section.name}` : project.name) : 'Inbox');

	let creating = $state(false);
	let name = $state('');

	function create(close: () => void) {
		const trimmed = name.trim();
		creating = false;
		name = '';
		if (!trimmed) return;
		onchange({ projectId: store.addProject(trimmed).id, sectionId: null });
		close();
	}
</script>

<div class="flex min-w-0 items-center">
	<Popover label="Project" {align}>
		{#snippet trigger({ toggle })}
			<button type="button" class="chip max-w-full" data-active={!!project} aria-label={`Project ${label}`} onclick={toggle}>
				{#if project}<Hash size={15} class="shrink-0" />{:else}<Tray size={15} class="shrink-0" />{/if}
				<span class="truncate">{label}</span>
			</button>
		{/snippet}
		{#snippet children({ close })}
			<div class="max-h-[min(60vh,22rem)] overflow-y-auto">
				{#each options as option (`${option.place.projectId}:${option.place.sectionId}`)}
					<button
						type="button"
						class="menu-item {option.nested ? 'pl-7' : ''}"
						onclick={() => {
							onchange(option.place);
							close();
						}}
					>
						{#if option.nested}<Rows size={14} class="text-faint" />{:else if option.place.projectId}<Hash size={15} class="text-muted" />{:else}<Tray size={15} class="text-muted" />{/if}
						<span class="flex-1 truncate">{option.name}</span>
						{#if option.place.projectId === projectId && option.place.sectionId === (sectionId ?? null)}<Check size={14} class="text-accent" />{/if}
					</button>
				{/each}
			</div>
			{#if canCreate}
				<div class="mt-1 border-t border-ink/5 pt-1">
					{#if creating}
						<input
							class="field w-full"
							aria-label="New project name"
							placeholder="Project name"
							{@attach (node) => node.focus()}
							bind:value={name}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									e.stopPropagation();
									create(close);
								} else if (e.key === 'Escape') {
									e.preventDefault();
									e.stopPropagation();
									creating = false;
									name = '';
								}
							}}
							onblur={() => create(close)}
						/>
					{:else}
						<button type="button" class="menu-item text-muted" onclick={() => (creating = true)}>
							<Plus size={15} />
							<span class="flex-1">New project</span>
						</button>
					{/if}
				</div>
			{/if}
		{/snippet}
	</Popover>
</div>
