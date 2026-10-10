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
	import { labelTasks } from '#lib/views.ts';

	const label = $derived(store.label(page.params.id ?? ''));
	const tasks = $derived(label ? labelTasks(store.tasks, label.id) : []);

	let renaming = $state(false);
	let confirmingDelete = $state(false);

	function rename(name: string) {
		if (label && name.trim()) store.renameLabel(label.id, name.trim());
		renaming = false;
	}

	function remove() {
		if (!label) return;
		store.deleteLabel(label.id);
		void goto('/inbox');
	}
</script>

<svelte:head><title>{label?.name ?? 'Label'} · Procrastimate</title></svelte:head>

{#if label}
	<View
		empty={tasks.length === 0}
		emptyTitle="No tasks with this label"
		emptyHint={`Type @${label.name} in quick add, or pick it in a task's details.`}
		quickAdd={{ projectId: null, labelId: label.id, today: false }}
	>
		{#snippet title()}
			{#if renaming}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="w-full rounded-xl bg-ink/[0.05] px-1.5 text-[26px] font-semibold tracking-tight outline-none"
					aria-label="Label name"
					value={label.name}
					autofocus
					onblur={(e) => rename(e.currentTarget.value)}
					onkeydown={(e) => {
						if (e.key === 'Enter') rename(e.currentTarget.value);
						if (e.key === 'Escape') renaming = false;
					}}
				/>
			{:else}
				<h1 class="truncate text-[26px] font-semibold tracking-tight">{label.name}</h1>
			{/if}
		{/snippet}
		{#snippet actions()}
			<Popover label="Label actions" align="end">
				{#snippet trigger({ toggle })}
					<button type="button" class="icon-btn touch:size-11" aria-label="Label actions" onclick={() => {
						confirmingDelete = false;
						toggle();
					}}>
						<DotsThree size={20} weight="bold" />
					</button>
				{/snippet}
				{#snippet children({ close })}
					{#if confirmingDelete}
						<div class="w-60 p-1.5 text-[13px]">
							<p>Delete <strong>{label.name}</strong>? Its tasks stay, without the label.</p>
							<div class="mt-2 flex justify-end gap-1.5">
								<button type="button" class="btn btn-quiet" onclick={close}>Cancel</button>
								<button type="button" class="btn press bg-[var(--tone-overdue)] text-on-accent" onclick={remove}>Delete</button>
							</div>
						</div>
					{:else}
						<button type="button" class="menu-item" onclick={() => {
							renaming = true;
							close();
						}}><PencilSimple size={15} />Rename</button>
						<button type="button" class="menu-item text-[var(--tone-overdue)]" onclick={() => (confirmingDelete = true)}><Trash size={15} />Delete label</button>
					{/if}
				{/snippet}
			</Popover>
		{/snippet}
		<TaskList {tasks} showProject label={`${label.name} tasks`} />
	</View>
{:else}
	<p class="mt-16 text-center text-muted">This label no longer exists.</p>
{/if}
