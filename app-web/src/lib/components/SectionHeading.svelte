<script lang="ts">
	import type { Task } from 'shared/task.ts';
	import CopyButton from './CopyButton.svelte';

	let { heading, tasks, class: className = '' }: { heading: string; tasks: Task[]; class?: string } = $props();
</script>

<div class="group mb-1 flex items-center justify-between gap-2 border-b border-ink/[0.07] pr-1 pb-1.5 pl-2">
	<h2 class="min-w-0 truncate text-[13px] font-semibold {className}">{heading}</h2>
	<span class="-my-1 flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
		<CopyButton
			label={`Copy ${heading} as Markdown`}
			markdown={() => ({ title: null, projectId: null, sections: [{ heading, tasks }] })}
			size={14}
			class="hit-area size-6!"
		/>
	</span>
</div>
