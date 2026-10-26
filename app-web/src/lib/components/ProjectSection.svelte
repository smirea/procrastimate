<script lang="ts">
	import ArrowDown from 'phosphor-svelte/lib/ArrowDown';
	import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
	import { sectionTasks } from 'shared/store.ts';
	import type { Section, Task } from 'shared/task.ts';
	import CompletedList from './CompletedList.svelte';
	import InlineEdit from './InlineEdit.svelte';
	import SectionMenu from './SectionMenu.svelte';
		import SectionHeading from './SectionHeading.svelte';
	import TaskList from './TaskList.svelte';
	import { toastDeleted } from '../completion.ts';
	import { store } from '../store.svelte.ts';

	/**
	 * `done` are the section's completed tasks when the view shows them, under its open ones. `editable` is the owner's
	 * own project, whose sections can be renamed, moved, and deleted.
	 */
	let {
		section,
		tasks,
		done,
		index,
		count,
		editable,
		canAdd,
	}: { section: Section; tasks: Task[]; done: Task[]; index: number; count: number; editable: boolean; canAdd: boolean } = $props();

	let renaming = $state(false);
</script>

<section class="mt-6" aria-label={section.name}>
	<SectionHeading heading={section.name} {tasks} add={canAdd ? { kind: 'project', id: section.projectId, sectionId: section.id } : undefined}>
		{#snippet title()}
			{#if renaming}
				<InlineEdit
					class="-my-1 min-w-0 flex-1 rounded-lg bg-ink/[0.05] px-1 py-0.5 text-[15px] font-semibold outline-none"
					label="Section name"
					value={section.name}
					oncommit={(name) => store.renameSection(section.id, name)}
					onclose={() => (renaming = false)}
				/>
			{:else if editable}
				<SectionMenu
					name={section.name}
					ondelete={() => toastDeleted(section.name, store.deleteSection(section.id))}
					onrename={() => (renaming = true)}
				>
					{#snippet confirm()}
						{@const removing = sectionTasks(store.tasks, section.id).length}
						Delete <strong>{section.name}</strong>{removing ? ` and its ${removing} task${removing === 1 ? '' : 's'}` : ''}?
					{/snippet}
					{#snippet after({ close })}
						<button type="button" class="menu-item" disabled={index === 0} onclick={() => {
							store.moveSection(section.id, index - 1);
							close();
						}}><ArrowUp size={15} />Move up</button>
						<button type="button" class="menu-item" disabled={index === count - 1} onclick={() => {
							store.moveSection(section.id, index + 1);
							close();
						}}><ArrowDown size={15} />Move down</button>
					{/snippet}
				</SectionMenu>
			{:else}
				<h2 class="min-w-0 truncate text-[15px] font-semibold">{section.name}</h2>
			{/if}
		{/snippet}
	</SectionHeading>
	<TaskList {tasks} label={`${section.name} tasks`} />
	{#if done.length}
		<CompletedList tasks={done} label={`Completed ${section.name} tasks`} />
	{/if}
</section>
