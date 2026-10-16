<script lang="ts">
	import ArrowDown from 'phosphor-svelte/lib/ArrowDown';
	import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
	import DotsThree from 'phosphor-svelte/lib/DotsThree';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { sectionTasks } from 'shared/store.ts';
	import type { Section, Task } from 'shared/task.ts';
	import AddTaskButton from './AddTaskButton.svelte';
	import Popover from './Popover.svelte';
	import SectionHeading from './SectionHeading.svelte';
	import TaskList from './TaskList.svelte';
	import { store } from '../store.svelte.ts';

	/** `editable` is the owner's own project, whose sections can be renamed, moved, and deleted. */
	let {
		section,
		tasks,
		index,
		count,
		editable,
		canAdd,
	}: { section: Section; tasks: Task[]; index: number; count: number; editable: boolean; canAdd: boolean } = $props();

	const removing = $derived(sectionTasks(store.tasks, section.id).length);
	let renaming = $state(false);
	let confirmingDelete = $state(false);

	function rename(name: string) {
		if (name.trim()) store.renameSection(section.id, name.trim());
		renaming = false;
	}
</script>

<section class="mt-6" aria-label={section.name}>
	<SectionHeading heading={section.name} {tasks} projectId={section.projectId}>
		{#snippet title()}
			{#if renaming}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="-my-1 min-w-0 flex-1 rounded-lg bg-ink/[0.05] px-1 py-0.5 text-[13px] font-semibold outline-none"
					aria-label="Section name"
					value={section.name}
					autofocus
					onblur={(e) => rename(e.currentTarget.value)}
					onkeydown={(e) => {
						if (e.key === 'Enter') rename(e.currentTarget.value);
						if (e.key === 'Escape') renaming = false;
					}}
				/>
			{:else}
				<h2 class="flex min-w-0 items-baseline gap-1.5 text-[13px] font-semibold">
					<span class="truncate">{section.name}</span>
					{#if tasks.length}<span class="shrink-0 text-[12px] font-normal text-faint tabular-nums">{tasks.length}</span>{/if}
				</h2>
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if editable}
				<Popover label="Section actions" align="end">
					{#snippet trigger({ toggle })}
						<button
							type="button"
							class="icon-btn hit-area size-6!"
							aria-label={`${section.name} actions`}
							onclick={() => {
								confirmingDelete = false;
								toggle();
							}}
						>
							<DotsThree size={16} weight="bold" />
						</button>
					{/snippet}
					{#snippet children({ close })}
						{#if confirmingDelete}
							<div class="w-60 p-1.5 text-[13px]">
								<p>Delete <strong>{section.name}</strong>{removing ? ` and its ${removing} task${removing === 1 ? '' : 's'}` : ''}?</p>
								<div class="mt-2 flex justify-end gap-1.5">
									<button type="button" class="btn btn-quiet" onclick={close}>Cancel</button>
									<button
										type="button"
										class="btn press bg-[var(--tone-overdue)] text-on-accent"
										onclick={() => {
											close();
											store.deleteSection(section.id);
										}}>Delete</button
									>
								</div>
							</div>
						{:else}
							<button type="button" class="menu-item" onclick={() => {
								renaming = true;
								close();
							}}><PencilSimple size={15} />Rename</button>
							<button type="button" class="menu-item" disabled={index === 0} onclick={() => {
								store.moveSection(section.id, index - 1);
								close();
							}}><ArrowUp size={15} />Move up</button>
							<button type="button" class="menu-item" disabled={index === count - 1} onclick={() => {
								store.moveSection(section.id, index + 1);
								close();
							}}><ArrowDown size={15} />Move down</button>
							<button type="button" class="menu-item text-[var(--tone-overdue)]" onclick={() => (confirmingDelete = true)}><Trash size={15} />Delete section</button>
						{/if}
					{/snippet}
				</Popover>
			{/if}
		{/snippet}
	</SectionHeading>
	<TaskList {tasks} label={`${section.name} tasks`} />
	{#if canAdd}
		<AddTaskButton quickAdd={{ projectId: section.projectId, sectionId: section.id, labelId: null, today: false }} />
	{/if}
</section>
