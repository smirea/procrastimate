<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import RowsPlusBottom from 'phosphor-svelte/lib/RowsPlusBottom';
	import ShareNetwork from 'phosphor-svelte/lib/ShareNetwork';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import AddTaskButton from '#lib/components/AddTaskButton.svelte';
	import ProjectSection from '#lib/components/ProjectSection.svelte';
	import EntityActions from '#lib/components/EntityActions.svelte';
	import InlineEdit from '#lib/components/InlineEdit.svelte';
	import CompletedSection from '#lib/components/CompletedSection.svelte';
	import CompletedToggle from '#lib/components/CompletedToggle.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { toastDeleted } from '#lib/completion.ts';
	import { leaving, motion, sheets } from '#lib/ui.svelte.ts';
	import { projectDocument } from 'shared/markdown.ts';
	import { completed } from '#lib/completed.svelte.ts';
	import { canAddHere } from '#lib/screen.ts';
	import { projectCompleted, projectGroups } from 'shared/views.ts';
	import CompletedList from '#lib/components/CompletedList.svelte';

	const project = $derived(store.project(page.params.id ?? null));
	const groups = $derived(project ? projectGroups(store.tasks, store.sections, project.id) : []);
	const loose = $derived(groups[0]?.tasks ?? []);
	const sections = $derived(groups.slice(1).map((g) => ({ section: g.section!, tasks: g.tasks })));
	const tasks = $derived(groups.flatMap((g) => g.tasks));
	const done = $derived(project && completed.shown(`project:${project.id}`) ? projectCompleted(store.tasks, store.sections, project.id) : null);
	const doneIn = (id: string | null) => done?.groups.find((g) => (g.section?.id ?? null) === id)?.tasks ?? [];
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

{#if project}
	<View
		name={project.name}
		open={tasks.length}
		empty={tasks.length === 0 && sections.length === 0 && !anyDone}
		emptyTitle="No tasks yet"
		emptyHint={`Add one here, or type #${project.name} in quick add.`}
		subtitle={owner ? `Shared by ${owner.name}` : undefined}
		canAdd={false}
		markdown={() => projectDocument(project, groups)}
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
				<h1 class="truncate text-[26px] font-semibold tracking-tight">{project.name}</h1>
			{/if}
		{/snippet}
		{#snippet actions()}
			<CompletedToggle list={`project:${project.id}`} />
			{#if !home}
				<div class="flex items-center gap-1">
					<button type="button" class="icon-btn touch:size-11" aria-label="Share project" onclick={() => sheets.openShare({ kind: 'project', id: project.id }, project.name)}>
						<ShareNetwork size={19} />
					</button>
					<EntityActions label="Project actions" triggerLabel="Project actions" deleteLabel="Delete project" ondelete={remove} onrename={() => (renaming = true)}>
						{#snippet confirm()}
							Delete <strong>{project.name}</strong> and its {tasks.length} task{tasks.length === 1 ? '' : 's'}?
						{/snippet}
					</EntityActions>
				</div>
			{/if}
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
