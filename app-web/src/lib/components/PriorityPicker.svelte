<script lang="ts">
	import { feedback } from '@stefan.inc/feedback-engine/svelte';
	import Flag from 'phosphor-svelte/lib/Flag';
	import Check from 'phosphor-svelte/lib/Check';
	import { DEFAULT_PRIORITY, type Priority } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import { PRIORITIES } from '../priorities.ts';

	let {
		priority,
		onchange,
		iconOnly = false,
		open = $bindable(false),
	}: { priority: Priority; onchange: (priority: Priority) => void; iconOnly?: boolean; open?: boolean } = $props();

	const levels: Priority[] = [1, 2, 3, 4];
</script>

<div {@attach feedback()} class="flex items-center">
	<Popover label="Priority" align={iconOnly ? 'end' : 'start'} bind:open>
		{#snippet trigger({ toggle })}
			<button
				type="button"
				class="chip"
				data-active={priority !== DEFAULT_PRIORITY}
				style={iconOnly && priority !== DEFAULT_PRIORITY ? `background: color-mix(in srgb, ${PRIORITIES[priority].tone} 18%, transparent)` : ''}
				aria-label={`Priority ${priority}`}
				onclick={toggle}
			>
				<Flag size={15} weight={priority !== DEFAULT_PRIORITY ? 'fill' : 'regular'} color={priority !== DEFAULT_PRIORITY ? PRIORITIES[priority].tone : undefined} />
				{#if !iconOnly}{priority !== DEFAULT_PRIORITY ? `P${priority}` : 'Priority'}{/if}
			</button>
		{/snippet}
		{#snippet children({ close })}
			{#each levels as level (level)}
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						onchange(level);
						close();
					}}
				>
					<Flag size={15} weight={level !== DEFAULT_PRIORITY ? 'fill' : 'regular'} color={PRIORITIES[level].tone} />
					<span class="flex-1">{PRIORITIES[level].label}</span>
					{#if level === priority}<Check size={14} class="text-accent" />{/if}
				</button>
			{/each}
		{/snippet}
	</Popover>
</div>
