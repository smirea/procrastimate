<script lang="ts">
	import ArrowElbowDownRight from 'phosphor-svelte/lib/ArrowElbowDownRight';
	import Check from 'phosphor-svelte/lib/Check';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Trash from 'phosphor-svelte/lib/Trash';
	import Tray from 'phosphor-svelte/lib/Tray';
	import type { Task } from 'shared/task.ts';
	import { completedWhen } from 'shared/format.ts';
	import { completedMoment } from 'shared/views.ts';
	import { progressOf } from 'shared/subtasks.ts';
	import Checkbox from './Checkbox.svelte';
	import LinkedText from './LinkedText.svelte';
	import PersonName from './PersonName.svelte';
	import SubtaskProgress from './SubtaskProgress.svelte';
	import { useLookup } from '../lookup.ts';
	import { PRIORITIES } from '../priorities.ts';
	import { deleteTask, reopenTask } from '../completion.ts';
	import { session } from '../session.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { clock } from '../ui.svelte.ts';

	let { task, showProject = false }: { task: Task; showProject?: boolean } = $props();

	const lookup = useLookup();
	let reopening = $state(false);
	/** A repeating task is still open after a roll, so there is nothing to reopen. */
	const rolled = $derived(task.completedAt === null);
	const editable = $derived(!rolled && lookup.canEdit(task.id));
	const at = $derived(completedMoment(task)!);
	/** Null `completedBy` is a completion from before the server stamped them, or one not synced yet, so it names no one. */
	const other = $derived(task.completedBy !== null && task.completedBy !== session.userId);
	const by = $derived(other ? store.person(task.completedBy) : undefined);
	const project = $derived(lookup.project(task.projectId));
	const parent = $derived(task.parentId ? lookup.task(task.parentId) : undefined);
	const progress = $derived(progressOf(lookup.subtasks(task.id)));
	const tone = $derived(PRIORITIES[task.priority].tone);

	function reopen() {
		if (reopening) return;
		reopening = true;
		setTimeout(() => {
			reopenTask(task);
			reopening = false;
		}, 260);
	}
</script>

<div class="group flex items-start gap-3 rounded-2xl px-2 hover:bg-surface/60" data-task={task.title}>
	{#if editable}
		<Checkbox checked={!reopening} {tone} label={`Reopen ${task.title}`} class="mt-3 touch:mt-3.5" onclick={reopen} />
	{:else}
		<span
			class="mt-3 grid size-[18px] shrink-0 place-items-center rounded-full text-white touch:mt-3.5 touch:size-5"
			style={`background: ${tone}`}
			role="img"
			aria-label={`Completed ${task.title}`}
		>
			<Check size={10} weight="bold" />
		</span>
	{/if}
	<div class="relative min-w-0 flex-1 py-2.5 touch:min-h-11 touch:py-3">
		{#if lookup.open}
			<button type="button" class="absolute inset-0 rounded-xl" aria-label={task.title} onclick={() => lookup.open?.(task.id)}></button>
		{/if}
		<div class="pointer-events-none relative">
			<div class="truncate text-[14px] leading-5 text-muted line-through decoration-faint transition-colors" class:reopening>
				<LinkedText text={task.title} />
			</div>
			<div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-muted">
				<time datetime={new Date(at).toISOString()} aria-label={`Completed ${completedWhen(at, clock.today)}`}>{completedWhen(at, clock.today)}</time>
				{#if rolled}
					<span class="flex items-center text-[var(--tone-repeat)]" role="img" aria-label="Repeats">
						<Repeat size={12} weight="bold" />
					</span>
				{/if}
				{#if other}
					<span class="flex min-w-0 items-center gap-1" aria-label={`Completed by ${by?.name ?? 'someone else'}`}>
						by <PersonName person={by} class="text-ink" />
					</span>
				{/if}
				{#if progress}
					<SubtaskProgress {progress} />
				{/if}
				{#if parent}
					<span class="flex min-w-0 items-center gap-1" aria-label={`Subtask of ${parent.title}`}>
						<ArrowElbowDownRight size={12} class="shrink-0" /><span class="truncate">{parent.title}</span>
					</span>
				{/if}
				{#if showProject}
					<span class="ml-auto flex shrink-0 items-center gap-1">
						{#if project}<Hash size={12} />{project.name}{:else}<Tray size={12} />Inbox{/if}
					</span>
				{/if}
			</div>
		</div>
	</div>
	{#if editable}
		<div class="mt-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
			<button type="button" class="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5" aria-label={`Delete ${task.title}`} onclick={() => deleteTask(task)}>
				<Trash size={16} />
			</button>
		</div>
	{/if}
</div>

<style>
	.reopening {
		color: var(--color-ink);
		text-decoration-color: transparent;
	}
</style>
