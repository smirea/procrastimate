<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DotsThree from 'phosphor-svelte/lib/DotsThree';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import Trash from 'phosphor-svelte/lib/Trash';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import Popover from '#lib/components/Popover.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { projectTasks } from '#lib/views.ts';

	const project = $derived(store.project(page.params.id ?? null));
	const tasks = $derived(project ? projectTasks(store.tasks, project.id) : []);

	let renaming = $state(false);
	let confirmingDelete = $state(false);

	function rename(name: string) {
		if (project && name.trim()) store.renameProject(project.id, name.trim());
		renaming = false;
	}

	function remove() {
		if (!project) return;
		store.deleteProject(project.id);
		void goto('/inbox');
	}
</script>

<svelte:head><title>{project?.name ?? 'Project'} · Procrastimate</title></svelte:head>

{#if project}
	<View
		empty={tasks.length === 0}
		emptyTitle="No tasks yet"
		emptyHint={`Add one here, or type #${project.name} in quick add.`}
		quickAdd={{ projectId: project.id, today: false }}
	>
		{#snippet title()}
			{#if renaming}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="w-full rounded-lg bg-surface/70 px-1 text-[26px] font-semibold tracking-tight outline-none"
					aria-label="Project name"
					value={project.name}
					autofocus
					onblur={(e) => rename(e.currentTarget.value)}
					onkeydown={(e) => {
						if (e.key === 'Enter') rename(e.currentTarget.value);
						if (e.key === 'Escape') renaming = false;
					}}
				/>
			{:else}
				<h1 class="truncate text-[26px] font-semibold tracking-tight">{project.name}</h1>
			{/if}
		{/snippet}
		{#snippet actions()}
			<Popover label="Project actions" align="end">
				{#snippet trigger({ toggle })}
					<button type="button" class="grid size-9 place-items-center rounded-xl text-muted transition-colors hover:bg-ink/5 hover:text-ink touch:size-11" aria-label="Project actions" onclick={() => {
						confirmingDelete = false;
						toggle();
					}}>
						<DotsThree size={20} weight="bold" />
					</button>
				{/snippet}
				{#snippet children({ close })}
					{#if confirmingDelete}
						<div class="w-60 p-1.5 text-[13px]">
							<p>Delete <strong>{project.name}</strong> and its {tasks.length} task{tasks.length === 1 ? '' : 's'}?</p>
							<div class="mt-2 flex justify-end gap-1.5">
								<button type="button" class="btn btn-quiet" onclick={close}>Cancel</button>
								<button type="button" class="btn bg-[var(--tone-overdue)] text-on-accent" onclick={remove}>Delete</button>
							</div>
						</div>
					{:else}
						<button type="button" class="menu-item" onclick={() => {
							renaming = true;
							close();
						}}><PencilSimple size={15} />Rename</button>
						<button type="button" class="menu-item text-[var(--p1)]" onclick={() => (confirmingDelete = true)}><Trash size={15} />Delete project</button>
					{/if}
				{/snippet}
			</Popover>
		{/snippet}
		<TaskList {tasks} label={`${project.name} tasks`} />
	</View>
{:else}
	<p class="mt-16 text-center text-muted">This project no longer exists.</p>
{/if}
