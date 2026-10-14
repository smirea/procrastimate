<script lang="ts">
	import Flag from 'phosphor-svelte/lib/Flag';
	import Check from 'phosphor-svelte/lib/Check';
	import type { Priority } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import KeepAsText from './KeepAsText.svelte';
	import { PRIORITIES } from '../priorities.ts';

	let {
		priority,
		onchange,
		onkeepastext,
		iconOnly = false,
	}: { priority: Priority; onchange: (priority: Priority) => void; onkeepastext?: () => void; iconOnly?: boolean } = $props();

	const levels: Priority[] = [1, 2, 3, 4];
</script>

<div class="flex items-center">
	<Popover label="Priority" align={iconOnly ? 'end' : 'start'}>
		{#snippet trigger({ toggle })}
			<button
				type="button"
				class="chip"
				data-active={priority !== 4}
				aria-label={`Priority ${priority}`}
				onclick={toggle}
			>
				<Flag size={15} weight={priority !== 4 ? 'fill' : 'regular'} color={priority !== 4 ? PRIORITIES[priority].tone : undefined} />
				{#if !iconOnly}{priority !== 4 ? `P${priority}` : 'Priority'}{/if}
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
					<Flag size={15} weight={level !== 4 ? 'fill' : 'regular'} color={PRIORITIES[level].tone} />
					<span class="flex-1">{PRIORITIES[level].label}</span>
					{#if level === priority}<Check size={14} class="text-accent" />{/if}
				</button>
			{/each}
		{/snippet}
	</Popover>
	{#if onkeepastext}<KeepAsText onclick={onkeepastext} />{/if}
</div>
