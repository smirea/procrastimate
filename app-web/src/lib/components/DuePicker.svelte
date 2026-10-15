<script lang="ts">
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import type { Due } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import DuePanel from './DuePanel.svelte';
	import { dueTone, formatDue } from 'shared/format.ts';
	import { clock } from '../ui.svelte.ts';

	let {
		due,
		onchange,
		open = $bindable(false),
	}: { due: Due | null; onchange: (due: Due | null) => void; open?: boolean } = $props();

	const today = $derived(clock.today);
</script>

<div class="flex items-center">
	<Popover label="Due date" bind:open>
		{#snippet trigger({ toggle })}
			<button
				type="button"
				class="chip"
				data-active={!!due}
				aria-label={due ? `Due ${formatDue(due, today)}` : 'Set due date'}
				onclick={toggle}
				style={due ? `color: var(--tone-${dueTone(due, today)})` : ''}
			>
				<CalendarBlank size={15} weight={due ? 'fill' : 'regular'} />
				{due ? formatDue(due, today) : 'Date'}
			</button>
		{/snippet}
		{#snippet children({ close })}
			<DuePanel {due} {onchange} {close} />
		{/snippet}
	</Popover>
</div>
