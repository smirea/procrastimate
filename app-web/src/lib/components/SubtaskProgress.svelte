<script lang="ts">
	import type { Progress } from 'shared/subtasks.ts';

	let { progress }: { progress: Progress } = $props();

	const CIRCUMFERENCE = 2 * Math.PI * 4.5;
	const complete = $derived(progress.done === progress.total);
</script>

<span class="flex items-center gap-1 tabular-nums" class:text-accent={complete} role="img" aria-label={`${progress.done} of ${progress.total} subtasks done`}>
	<svg viewBox="0 0 12 12" class="size-3 -rotate-90" aria-hidden="true">
		<circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.75" />
		<circle
			class="arc"
			cx="6"
			cy="6"
			r="4.5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			opacity={progress.done ? 1 : 0}
			stroke-dasharray={CIRCUMFERENCE}
			stroke-dashoffset={CIRCUMFERENCE * (1 - progress.done / progress.total)}
		/>
	</svg>
	{progress.done}/{progress.total}
</span>

<style>
	.arc {
		transition: stroke-dashoffset 320ms var(--ease-spring);
	}
</style>
