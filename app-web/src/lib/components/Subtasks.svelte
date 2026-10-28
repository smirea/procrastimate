<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Plus from 'phosphor-svelte/lib/Plus';
	import DotsSixVertical from 'phosphor-svelte/lib/DotsSixVertical';
	import DotsThree from 'phosphor-svelte/lib/DotsThree';
	import ArrowUpRight from 'phosphor-svelte/lib/ArrowUpRight';
	import TextAa from 'phosphor-svelte/lib/TextAa';
	import Tag from 'phosphor-svelte/lib/Tag';
	import type { ExplodeMethod } from 'shared/store.ts';
	import type { Task } from 'shared/task.ts';
	import SmartInput from './SmartInput.svelte';
	import SubtaskPlainText from './SubtaskPlainText.svelte';
	import SubtaskProgress from './SubtaskProgress.svelte';
	import Popover from './Popover.svelte';
	import TaskRow from './TaskRow.svelte';
	import { store } from '../store.svelte.ts';
	import { parseSubtask, subtaskTask } from '../subtask-draft.ts';
	import { leaving, sheets, motion } from '../ui.svelte.ts';
	import { toastUndo } from '../completion.ts';
	import { Reorder } from '../reorder.svelte.ts';
	let { task }: { task: Task } = $props();

	const children = $derived(store.children(task.id));
	const editable = $derived(store.canEdit(task.id));
	const progress = $derived(store.progress(task.id));

	let draft = $state('');
	let literal = $state(false);
	let input = $state<SmartInput>();
	const parsed = $derived(parseSubtask(draft, literal));

	function add() {
		const subtask = subtaskTask(parsed);
		if (!subtask) return;
		store.addTask(subtask, task.id);
		draft = '';
		literal = false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			add();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			if (draft) {
				draft = '';
				literal = false;
			} else sheets.close();
		}
	}

	const explodeOptions = $derived([
		{ method: 'direct', label: 'Keep titles', Icon: ArrowUpRight },
		{ method: 'prefix', label: `Start with “${task.title}:”`, Icon: TextAa },
		{ method: 'inherit', label: 'Inherit labels, date, and priority', Icon: Tag },
	] satisfies { method: ExplodeMethod; label: string; Icon: typeof Tag }[]);

	/** The parent stays, and the toast undoes it. */
	function explode(method: ExplodeMethod) {
		const previous = store.explodeSubtasks(task.id, method);
		if (!previous.length) return;
		const message = previous.length === 1 ? 'Turned 1 subtask into a task' : `Turned ${previous.length} subtasks into tasks`;
		toastUndo(message, { kind: 'explode', previous });
	}

	let list: HTMLUListElement;
	const reorder = new Reorder({ key: 'data-subtask-id', lift: 'handle', count: () => children.length, move: (id, to) => store.moveSubtask(id, to) });

	async function moveByKey(event: KeyboardEvent, id: string, index: number) {
		const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
		if (to === null) return;
		event.preventDefault();
		if (to < 0 || to >= children.length) return;
		store.moveSubtask(id, to);
		await tick();
		list.querySelector<HTMLElement>(`[data-subtask-id="${id}"] [data-handle]`)?.focus();
	}
</script>

<section aria-label="Subtasks">
	<div class="mb-1 flex items-center justify-between px-2 text-[12px] text-muted">
		<h2 class="font-medium tracking-wide uppercase">Subtasks</h2>
		<div class="flex items-center gap-1">
			{#if progress}<SubtaskProgress {progress} />{/if}
			{#if store.homeOf(task.id) === null && children.length}
				<Popover label="Turn into tasks" align="end">
					{#snippet trigger({ toggle })}
						<button type="button" class="hit-area relative grid size-6 place-items-center rounded-full text-muted transition-colors hover:text-ink" aria-label="Subtask actions" onclick={toggle}>
							<DotsThree size={16} weight="bold" />
						</button>
					{/snippet}
					{#snippet children({ close })}
						<div class="w-72 max-w-[calc(100vw-2rem)]">
							<p class="px-2.5 pt-1.5 pb-1 text-[12px] font-medium text-muted">Turn into tasks</p>
							{#each explodeOptions as option (option.method)}
								<button
									type="button"
									class="menu-item"
									onclick={() => {
										close();
										explode(option.method);
									}}
								>
									<option.Icon size={15} class="shrink-0" /><span class="flex-1 truncate">{option.label}</span>
								</button>
							{/each}
						</div>
					{/snippet}
				</Popover>
			{/if}
		</div>
	</div>
	<ul bind:this={list} {@attach reorder.list} class="relative" aria-label={`Subtasks of ${task.title}`}>
		{#each children as child, index (child.id)}
			<li
				{@attach leaving}
				data-subtask={child.title}
				data-subtask-id={child.id}
				class="relative rounded-2xl"
				class:glass-strong={reorder.drag?.id === child.id}
				class:lifted={reorder.drag?.id === child.id}
				class:shifting={!!reorder.drag && reorder.drag.id !== child.id}
				style:transform={reorder.drag ? `translateY(${reorder.offset(index, child.id)}px)` : undefined}
				animate:flip={motion({ duration: reorder.settling ? 0 : 220, easing: cubicOut })}
				in:fly={motion({ y: -6, duration: 200, easing: cubicOut })}
				out:slide={motion({ duration: 180, easing: cubicOut })}
			>
				<TaskRow task={child} subtask>
					{#snippet trailing()}
						{#if editable && children.length > 1}
							<button
								type="button"
								data-handle
								aria-label={`Reorder ${child.title}`}
								title="Drag, or use the arrow keys, to reorder"
								class="handle hit-area relative mt-1.5 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-faint transition-colors hover:text-muted"
								onpointerdown={(e) => reorder.start(e, child.id, index)}
								onkeydown={(e) => moveByKey(e, child.id, index)}
							>
								<DotsSixVertical size={16} weight="bold" />
							</button>
						{/if}
					{/snippet}
				</TaskRow>
			</li>
		{/each}
	</ul>
	{#if editable}
		<div class="flex items-center gap-3 px-2">
			<span class="grid size-[18px] shrink-0 place-items-center rounded-full text-accent touch:size-5"><Plus size={13} weight="bold" /></span>
			<SmartInput
				bind:this={input}
				bind:value={draft}
				tokens={parsed.tokens}
				label="Add subtask"
				placeholder="Add subtask"
				enterkeyhint="enter"
				suggestProjects={false}
				suggestNames={!literal}
				class="min-w-0 flex-1 py-2 text-[14px] touch:py-3"
				{onkeydown}
			/>
			<SubtaskPlainText
				on={literal}
				toggle={() => {
					literal = !literal;
					input?.focus();
				}}
			/>
		</div>
	{/if}
</section>

<style>
	.shifting {
		transition: transform 200ms var(--ease-spring);
	}

	.lifted {
		z-index: 10;
	}

	.lifted .handle {
		cursor: grabbing;
	}
</style>
