<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import ListMenu from '#lib/components/ListMenu.svelte';
	import InlineEdit from '#lib/components/InlineEdit.svelte';
	import CompletedSection from '#lib/components/CompletedSection.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { listFilters } from '#lib/list-filters.svelte.ts';
	import { session } from '#lib/session.svelte.ts';
	import { toastDeleted } from '#lib/completion.ts';
	import { sheets } from '#lib/ui.svelte.ts';
	import { completed } from '#lib/completed.svelte.ts';
	import { canAddHere } from '#lib/screen.ts';
	import { completedTasks, labelViewTasks } from 'shared/views.ts';
	import { formatRadius, placeKey } from 'shared/triggers.ts';
	import type { Task } from 'shared/task.ts';
	import { filterKey, filterTasks } from 'shared/list-filters.ts';
	import { listHeader } from 'shared/list-header.ts';
	import { labelStyle } from '#lib/label-colors.ts';
	import { labelIcon } from '#lib/label-icon.ts';

	const label = $derived(store.label(page.params.id ?? ''));
	/** A saved place lists the open tasks at it, which never carry it as a label. */
	const place = $derived(label?.place ?? null);
	const atPlace = (task: Task) => !!place && !!task.location && placeKey(task.location) === placeKey(place);
	const list = $derived(filterKey({ kind: 'label', id: page.params.id ?? '' }));
	const shown = (tasks: Task[]) => filterTasks(tasks, listFilters.get(list), session.userId ?? '');
	const all = $derived(label ? labelViewTasks(store.tasks, label) : []);
	const tasks = $derived(shown(all));
	const noun = $derived(place ? 'place' : 'label');
	/** The label's own slice, open and done, so a subtask finished with its parent stays under it. */
	const done = $derived(
		label && completed.shown(`label:${label.id}`)
			? shown(completedTasks(store.tasks.filter((t) => (place ? atPlace(t) : t.labelIds.includes(label.id))), { from: null, to: null }))
			: [],
	);
	const home = $derived(label ? store.homeOf(label.id) : null);
	const owner = $derived(home ? store.ownerOf(home) : undefined);

	let renaming = $state(false);

	function remove() {
		if (!label) return;
		toastDeleted(label.name, store.deleteLabel(label.id));
		void goto('/inbox');
	}
</script>

<svelte:head><title>{label?.name ?? 'Label'} · ProcrastiMate</title></svelte:head>

{#snippet deletePrompt()}
	{#if label}
		Delete <strong>{label.name}</strong>? {place ? 'Its tasks keep the place.' : 'Its tasks stay, without the label.'}
	{/if}
{/snippet}

{#if label}
	<View
		name={label.name}
		open={tasks.length}
		empty={all.length === 0}
		emptyTitle={place ? 'No tasks at this place' : 'No tasks with this label'}
		emptyHint={`Type @${label.name} in quick add, or pick it in a task's details.`}
		subtitle={owner ? `Shared by ${owner.name}` : place ? [formatRadius(place.radius), place.address].filter(Boolean).join(' · ') : undefined}
		canAdd={canAddHere({ kind: 'label', id: label.id })}
		filter={{ list, tasks: all }}
	>
		{#snippet title()}
			{#if renaming}
				<InlineEdit
					class="w-full rounded-xl bg-ink/[0.05] px-1.5 text-[26px] font-semibold tracking-tight outline-none"
					label={place ? 'Place name' : 'Label name'}
					value={label.name}
					oncommit={(name) => store.renameLabel(label.id, name)}
					onclose={() => (renaming = false)}
				/>
			{:else}
				{@const Icon = labelIcon(label)}
				<h1 class="flex min-w-0 items-center gap-2 text-[26px] font-semibold tracking-tight" style={labelStyle(label.color)}>
					<Icon size={22} weight="fill" class="shrink-0 text-[var(--label-tone)] transition-colors" />
					<span class="truncate">{label.name}</span>
				</h1>
			{/if}
		{/snippet}
		{#snippet actions()}
			<ListMenu
				header={listHeader({ kind: 'label', own: !home, place: !!place })}
				label={place ? 'Place actions' : 'Label actions'}
				markdown={() => ({ title: label.name, sections: [{ heading: null, tasks }] })}
				share={() => sheets.openShare({ kind: 'label', id: label.id }, label.name)}
				showCompleted={`label:${label.id}`}
				rename={() => (renaming = true)}
				color={{ value: label.color, set: (color) => store.setLabelColor(label.id, color), label: place ? 'Place color' : 'Label color' }}
				remove={{ label: `Delete ${noun}`, confirm: deletePrompt, run: remove }}
			/>
		{/snippet}
		<TaskList {tasks} showProject label={`${label.name} tasks`} />
		{#snippet after()}
			<CompletedSection tasks={done} list={`label:${label.id}`} showProject />
		{/snippet}
	</View>
{:else}
	<p class="mt-16 text-center text-muted">This label no longer exists.</p>
{/if}
