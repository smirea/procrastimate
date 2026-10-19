<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import RowsPlusBottom from 'phosphor-svelte/lib/RowsPlusBottom';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import AddTaskButton from '#lib/components/AddTaskButton.svelte';
	import ProjectSection from '#lib/components/ProjectSection.svelte';
	import ListMenu from '#lib/components/ListMenu.svelte';
	import InlineEdit from '#lib/components/InlineEdit.svelte';
	import ProjectGlyph from '#lib/components/ProjectGlyph.svelte';
	import CompletedSection from '#lib/components/CompletedSection.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { listFilters } from '#lib/list-filters.svelte.ts';
	import { session } from '#lib/session.svelte.ts';
	import { toastDeleted } from '#lib/completion.ts';
	import { leaving, motion, sheets } from '#lib/ui.svelte.ts';
	import { projectDocument } from 'shared/markdown.ts';
	import { completed } from '#lib/completed.svelte.ts';
	import { canAddHere } from '#lib/screen.ts';
	import { projectCompleted, projectGroups } from 'shared/views.ts';
	import type { Task } from 'shared/task.ts';
	import CompletedList from '#lib/components/CompletedList.svelte';
	import { filterKey, filterTasks } from 'shared/list-filters.ts';
	import { listHeader } from 'shared/list-header.ts';

	const project = $derived(store.project(page.params.id ?? null));
	const list = $derived(filterKey({ kind: 'project', id: page.params.id ?? '' }));
	const filter = $derived(listFilters.get(list));
	const shown = (tasks: Task[]) => filterTasks(tasks, filter, session.userId ?? '');
	const allGroups = $derived(project ? projectGroups(store.tasks, store.sections, project.id) : []);
	const groups = $derived(allGroups.map((g) => ({ ...g, tasks: shown(g.tasks) })));
	const loose = $derived(groups[0]?.tasks ?? []);
	const sections = $derived(groups.slice(1).map((g) => ({ section: g.section!, tasks: g.tasks })));
	const tasks = $derived(groups.flatMap((g) => g.tasks));
	const total = $derived(allGroups.reduce((n, g) => n + g.tasks.length, 0));
	const done = $derived(project && completed.shown(`project:${project.id}`) ? projectCompleted(store.tasks, store.sections, project.id) : null);
	const doneIn = (id: string | null) => shown(done?.groups.find((g) => (g.section?.id ?? null) === id)?.tasks ?? []);
	const anyDone = $derived(!!done && (done.gone.length > 0 || done.groups.some((g) => g.tasks.length > 0)));
	const home = $derived(project ? store.homeOf(project.id) : null);
	const owner = $derived(home ? store.ownerOf(home) : undefined);

	let renaming = $state(false);
	let addingSection = $state(false);

	const canAdd = $derived(!!project && canAddHere({ kind: 'project', id: project.id }));

	function remove() {
		if (!project) return;
		toastDeleted(project.name, store.deleteProject(project.id));
		void goto('/inbox');
	}
</script>

<svelte:head><title>{project?.name ?? 'Project'} · ProcrastiMate</title></svelte:head>

{#snippet deletePrompt()}
	{#if project}
		Delete <strong>{project.name}</strong> and its {total} task{total === 1 ? '' : 's'}?
	{/if}
{/snippet}

{#if project}
	<View
		name={project.name}
		open={tasks.length}
		empty={total === 0 && sections.length === 0 && !anyDone}
		emptyTitle="No tasks yet"
		emptyHint={`Add one here, or type #${project.name} in quick add.`}
		subtitle={owner ? `Shared by ${owner.name}` : undefined}
		canAdd={false}
		filter={{ list, tasks: allGroups.flatMap((g) => g.tasks) }}
	>
		{#snippet title()}
			{#if renaming}
				<InlineEdit
					class="w-full rounded-xl bg-ink/[0.05] px-1.5 text-[26px] font-semibold tracking-tight outline-none"
					label="Project name"
					value={project.name}
					oncommit={(name) => store.renameProject(project.id, name)}
					onclose={() => (renaming = false)}
				/>
			{:else}
				<h1 class="truncate text-[26px] font-semibold tracking-tight">
					{#if project.icon}<ProjectGlyph {project} size={24} class="mr-2 inline-block align-[-0.15em] text-muted" />{/if}{project.name}
				</h1>
			{/if}
		{/snippet}
		{#snippet actions()}
			<ListMenu
				header={listHeader({ kind: 'project', own: !home })}
				label="Project actions"
				markdown={() => projectDocument(project, groups)}
				share={() => sheets.openShare({ kind: 'project', id: project.id }, project.name)}
				showCompleted={`project:${project.id}`}
				addSection={() => (addingSection = true)}
				rename={() => (renaming = true)}
				icon={{ value: project.icon, set: (icon) => store.setProjectIcon(project.id, icon) }}
				remove={{ label: 'Delete project', confirm: deletePrompt, run: remove }}
			/>
		{/snippet}
		<TaskList tasks={loose} label={`${project.name} tasks`} />
		{#if doneIn(null).length}
			<CompletedList tasks={doneIn(null)} label={`Completed ${project.name} tasks`} />
		{/if}
		{#if canAdd}
			<AddTaskButton />
		{/if}
		{#each sections as { section, tasks: inSection }, index (section.id)}
			<div {@attach leaving} animate:flip={motion({ duration: 260, easing: cubicOut })} transition:fade={motion({ duration: 180 })}>
				<ProjectSection {section} tasks={inSection} done={doneIn(section.id)} {index} count={sections.length} editable={!home} {canAdd} />
			</div>
		{/each}
		{#if !home}
			{#if addingSection}
				<InlineEdit
					class="field mt-6 w-full text-[13px] font-semibold"
					label="New section name"
					placeholder="Section name"
					oncommit={(name) => store.addSection(project.id, name)}
					onclose={() => (addingSection = false)}
				/>
			{:else}
				<button
					type="button"
					class="press group mt-4 flex h-10 w-full items-center gap-3 rounded-full px-2 text-[14px] text-muted transition-colors hover:text-accent touch:h-12 touch:text-[15px]"
					onclick={() => (addingSection = true)}
				>
					<RowsPlusBottom size={18} class="text-accent" />
					Add section
				</button>
			{/if}
		{/if}
		{#snippet after()}
			{#if done && (done.gone.length || !anyDone)}
				<CompletedSection tasks={done.gone} list={`project:${project.id}`} />
			{/if}
		{/snippet}
	</View>
{:else}
	<p class="mt-16 text-center text-muted">This project no longer exists.</p>
{/if}
