<script lang="ts">
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CaretRight from 'phosphor-svelte/lib/CaretRight';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { addDays, addMonths, fromDateKey, mondayIndex, weekdayOf, type DateKey } from 'shared/task.ts';
	import { motion } from '../ui.svelte.ts';

	let {
		selected,
		today,
		onpick,
	}: { selected: DateKey | null; today: DateKey; onpick: (date: DateKey) => void } = $props();

	const firstOf = (date: DateKey) => `${date.slice(0, 8)}01` as DateKey;

	let month = $state(untrack(() => firstOf(selected ?? today)));
	let direction = $state(1);

	// Always six weeks, so the grid keeps its height from month to month.
	const days = $derived.by(() => {
		const start = addDays(month, -mondayIndex(weekdayOf(month)));
		return Array.from({ length: 42 }, (_, i) => addDays(start, i));
	});
	const title = $derived(fromDateKey(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));

	function step(months: number) {
		direction = months;
		month = addMonths(month, months);
	}

	const dayLabel = (date: DateKey) =>
		fromDateKey(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
</script>

<div class="px-1">
	<div class="flex items-center justify-between pb-1 pl-1.5">
		<span class="text-[13px] font-semibold touch:text-[15px]" aria-live="polite">{title}</span>
		<div class="flex">
			<button type="button" class="icon-btn size-8 touch:size-11" aria-label="Previous month" onclick={() => step(-1)}>
				<CaretLeft size={14} weight="bold" />
			</button>
			<button type="button" class="icon-btn size-8 touch:size-11" aria-label="Next month" onclick={() => step(1)}>
				<CaretRight size={14} weight="bold" />
			</button>
		</div>
	</div>
	<div class="grid grid-cols-7 text-center text-[11px] font-medium text-faint" aria-hidden="true">
		{#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as letter, i (i)}
			<span class="py-1">{letter}</span>
		{/each}
	</div>
	{#key month}
		<div
			class="grid grid-cols-7 place-items-center"
			role="group"
			aria-label={title}
			in:fly={motion({ x: 14 * direction, duration: 200, easing: cubicOut, opacity: 0 })}
		>
			{#each days as date (date)}
				{@const outside = date.slice(0, 7) !== month.slice(0, 7)}
				{@const isSelected = date === selected}
				<button
					type="button"
					class="day press grid size-9 place-items-center rounded-full text-[13px] tabular-nums touch:size-11 touch:text-[15px]"
					class:selected={isSelected}
					class:today={date === today && !isSelected}
					class:dim={(outside || date < today) && !isSelected}
					aria-label={dayLabel(date)}
					aria-pressed={isSelected}
					aria-current={date === today ? 'date' : undefined}
					onclick={() => onpick(date)}
				>
					{Number(date.slice(8))}
				</button>
			{/each}
		</div>
	{/key}
</div>

<style>
	.day {
		color: var(--color-ink);
		transition:
			background 160ms var(--ease-spring),
			color 160ms var(--ease-spring),
			scale 220ms var(--ease-spring);
	}

	.day.dim {
		color: var(--color-faint);
		opacity: 0.6;
	}

	.day.today {
		color: var(--color-accent);
		font-weight: 600;
	}

	.day.selected {
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-weight: 600;
	}

	.day:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	@media (hover: hover) {
		.day:not(.selected):hover {
			background: color-mix(in srgb, var(--color-ink) 7%, transparent);
		}
	}
</style>
