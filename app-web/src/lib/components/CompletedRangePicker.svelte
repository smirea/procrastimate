<script lang="ts">
	import CalendarDots from 'phosphor-svelte/lib/CalendarDots';
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import Check from 'phosphor-svelte/lib/Check';
	import { completedRangeLabel } from 'shared/format.ts';
	import type { DateKey } from 'shared/task.ts';
	import { completedPresetSchema, completedRange } from 'shared/views.ts';
	import Popover from './Popover.svelte';
	import { completed } from '../completed.svelte.ts';
	import { clock } from '../ui.svelte.ts';

	const range = $derived(completed.range(clock.today));
	let from = $state('');
	let to = $state('');

	function open(toggle: () => void) {
		from = range.from ?? clock.today;
		to = range.to ?? clock.today;
		toggle();
	}

	function apply(close: () => void) {
		if (!from || !to) return;
		const [start, end] = (from <= to ? [from, to] : [to, from]) as [DateKey, DateKey];
		completed.choose({ from: start, to: end });
		close();
	}
</script>

<Popover label="Completed when" align="end">
	{#snippet trigger({ toggle })}
		<button type="button" class="btn btn-quiet shrink-0" aria-label={`Completed ${completedRangeLabel(range, clock.today)}`} onclick={() => open(toggle)}>
			<CalendarDots size={14} weight="bold" />{completedRangeLabel(range, clock.today)}<CaretDown size={12} weight="bold" />
		</button>
	{/snippet}
	{#snippet children({ close })}
		<div class="w-60">
			{#each completedPresetSchema.options as preset (preset)}
				<button
					type="button"
					class="menu-item flex justify-between"
					aria-pressed={completed.choice === preset}
					onclick={() => {
						completed.choose(preset);
						close();
					}}
				>
					{completedRangeLabel(completedRange(preset, clock.today), clock.today)}
					{#if completed.choice === preset}<Check size={14} weight="bold" class="text-accent" />{/if}
				</button>
			{/each}
			<form
				class="mt-1 flex flex-col gap-1.5 border-t border-ink/[0.07] p-1.5 pt-2 text-[13px]"
				aria-label="Custom range"
				onsubmit={(e) => {
					e.preventDefault();
					apply(close);
				}}
			>
				<span class="text-[12px] font-medium text-muted">Custom range</span>
				<label class="flex items-center justify-between gap-2">From <input type="date" class="date-input" bind:value={from} max={clock.today} required /></label>
				<label class="flex items-center justify-between gap-2">To <input type="date" class="date-input" bind:value={to} max={clock.today} required /></label>
				<button type="submit" class="btn press mt-1 self-end bg-accent text-on-accent">Apply</button>
			</form>
		</div>
	{/snippet}
</Popover>

<style>
	.date-input {
		border-radius: 0.625rem;
		background: color-mix(in srgb, var(--color-ink) 5%, transparent);
		padding: 0.125rem 0.5rem;
		color: var(--color-ink);
	}
</style>
