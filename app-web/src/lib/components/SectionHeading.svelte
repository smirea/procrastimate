<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Task } from 'shared/task.ts';
	import CopyButton from './CopyButton.svelte';
	import PendingCount from './PendingCount.svelte';

	/**
	 * `projectId` names the project a heading sits in, whose rows then copy without their project tag. `counted` is off for
	 * done tasks, which are not pending.
	 */
	let {
		heading,
		tasks,
		projectId = null,
		counted = true,
		title,
		actions,
		class: className = '',
	}: {
		heading: string;
		tasks: Task[];
		projectId?: string | null;
		counted?: boolean;
		title?: Snippet;
		actions?: Snippet;
		class?: string;
	} = $props();
</script>

<div class="group mb-1 flex items-center justify-between gap-2 border-b border-ink/[0.07] pr-1 pb-1.5 pl-2">
	{#if title}
		{@render title()}
	{:else}
		<h2 class="min-w-0 truncate text-[13px] font-semibold {className}">{heading}</h2>
	{/if}
	<span class="-my-1 flex items-center gap-0.5">
		{#if counted}<PendingCount open={tasks.length} class="mr-1 text-[12px]" />{/if}
		<span class="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
			<CopyButton
				label={`Copy ${heading} as Markdown`}
				markdown={() => ({ title: null, projectId, sections: [{ heading, tasks }] })}
				size={14}
				class="hit-area size-6!"
			/>
		</span>
		{@render actions?.()}
	</span>
</div>
