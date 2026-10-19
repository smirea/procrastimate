<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Check from 'phosphor-svelte/lib/Check';
	import ShareNetwork from 'phosphor-svelte/lib/ShareNetwork';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import EntityActions from '#lib/components/EntityActions.svelte';
	import InlineEdit from '#lib/components/InlineEdit.svelte';
	import CompletedSection from '#lib/components/CompletedSection.svelte';
	import CompletedToggle from '#lib/components/CompletedToggle.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { toastDeleted } from '#lib/completion.ts';
	import { sheets } from '#lib/ui.svelte.ts';
	import { completed } from '#lib/completed.svelte.ts';
	import { canAddHere } from '#lib/screen.ts';
	import { completedTasks, labelViewTasks } from 'shared/views.ts';
	import { formatRadius, placeKey } from 'shared/triggers.ts';
	import { LABEL_COLORS } from 'shared/label-colors.ts';
	import type { Task } from 'shared/task.ts';
	import { labelColorName, labelStyle } from '#lib/label-colors.ts';
	import { labelIcon } from '#lib/label-icon.ts';

	const label = $derived(store.label(page.params.id ?? ''));
	/** A saved place lists the open tasks at it, which never carry it as a label. */
	const place = $derived(label?.place ?? null);
	const atPlace = (task: Task) => !!place && !!task.location && placeKey(task.location) === placeKey(place);
	const tasks = $derived(label ? labelViewTasks(store.tasks, label) : []);
	const noun = $derived(place ? 'place' : 'label');
	/** The label's own slice, open and done, so a subtask finished with its parent stays under it. */
	const done = $derived(
		label && completed.shown(`label:${label.id}`)
			? completedTasks(store.tasks.filter((t) => (place ? atPlace(t) : t.labelIds.includes(label.id))), { from: null, to: null })
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

{#if label}
	<View
		name={label.name}
		open={tasks.length}
		empty={tasks.length === 0}
		emptyTitle={place ? 'No tasks at this place' : 'No tasks with this label'}
		emptyHint={`Type @${label.name} in quick add, or pick it in a task's details.`}
		subtitle={owner ? `Shared by ${owner.name}` : place ? [formatRadius(place.radius), place.address].filter(Boolean).join(' · ') : undefined}
		canAdd={canAddHere({ kind: 'label', id: label.id })}
		markdown={() => ({ title: label.name, sections: [{ heading: null, tasks }] })}
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
			<CompletedToggle list={`label:${label.id}`} />
			{#if !home}
				<div class="flex items-center gap-1">
					<!-- Sharing goes by the tasks carrying a label, and a saved place's tasks carry none. -->
					{#if !place}
						<button type="button" class="icon-btn touch:size-11" aria-label="Share label" onclick={() => sheets.openShare({ kind: 'label', id: label.id }, label.name)}>
							<ShareNetwork size={19} />
						</button>
					{/if}
					<EntityActions
						label={place ? 'Place actions' : 'Label actions'}
						triggerLabel={place ? 'Place actions' : 'Label actions'}
						deleteLabel={`Delete ${noun}`}
						ondelete={remove}
						onrename={() => (renaming = true)}
					>
						{#snippet confirm()}
							Delete <strong>{label.name}</strong>? {place ? 'Its tasks keep the place.' : 'Its tasks stay, without the label.'}
						{/snippet}
						{#snippet before()}
								<div role="radiogroup" aria-label={place ? 'Place color' : 'Label color'} class="grid w-max grid-cols-6 gap-0.5 p-1">
									{#each LABEL_COLORS as color (color)}
										{@const checked = label.color === color}
										<button
											type="button"
											role="radio"
											aria-checked={checked}
											aria-label={labelColorName(color)}
											class="swatch press"
											style={labelStyle(color)}
											onclick={() => store.setLabelColor(label.id, color)}
										>
											<span class="grid size-6 place-items-center rounded-full bg-[var(--label-tone)] text-[var(--canvas)] touch:size-7">
												{#if checked}<Check size={13} weight="bold" />{/if}
											</span>
										</button>
									{/each}
								</div>
						{/snippet}
					</EntityActions>
				</div>
			{/if}
		{/snippet}
		<TaskList {tasks} showProject label={`${label.name} tasks`} />
		{#snippet after()}
			<CompletedSection tasks={done} list={`label:${label.id}`} showProject />
		{/snippet}
	</View>
{:else}
	<p class="mt-16 text-center text-muted">This label no longer exists.</p>
{/if}

<style>
	.swatch {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
	}

	.swatch[aria-checked='true'] {
		box-shadow: inset 0 0 0 2px var(--label-tone);
	}

	@media (max-width: 767px), (pointer: coarse) {
		.swatch {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
</style>
