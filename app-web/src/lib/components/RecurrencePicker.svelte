<script lang="ts">
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Check from 'phosphor-svelte/lib/Check';
	import { sortWeekdays, weekdayOf, type Due, type Recurrence, type RecurrenceUnit, type Weekday } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import { WEEKDAY_NAMES, formatRecurrence, repeatLabel } from '../format.ts';
	import { clock } from '../ui.svelte.ts';

	let {
		recurrence,
		due,
		onchange,
	}: { recurrence: Recurrence | null; due: Due | null; onchange: (recurrence: Recurrence | null) => void } = $props();

	const PRESETS: Recurrence[] = [
		{ interval: 1, unit: 'day' },
		{ interval: 1, unit: 'weekday' },
		{ interval: 1, unit: 'week' },
		{ interval: 1, unit: 'month' },
		{ interval: 1, unit: 'year' },
	];
	const UNITS: RecurrenceUnit[] = ['day', 'weekday', 'week', 'month', 'year'];
	const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

	let customInterval = $state<number | null>(2);
	let customUnit = $state<RecurrenceUnit>('day');
	/** An emptied number field binds `null`, which must never reach the task. */
	const customValid = $derived(Number.isInteger(customInterval) && customInterval! >= 1 && customInterval! <= 365);

	/** Setting a repeat on an undated task dates it today, so presets read as they will apply. */
	const anchor = $derived(due ?? { date: clock.today, time: null });

	/** A plain weekly repeat already repeats on its due weekday. Any other repeat starts with no days. */
	const weekdays = $derived<readonly Weekday[]>(recurrence?.unit === 'week' ? (recurrence.days ?? [weekdayOf(anchor.date)]) : []);

	function toggleDay(day: Weekday) {
		const days = sortWeekdays(weekdays.includes(day) ? weekdays.filter(d => d !== day) : [...weekdays, day]);
		onchange({ interval: recurrence?.unit === 'week' ? recurrence.interval : 1, unit: 'week', days });
	}

	const same = (a: Recurrence | null, b: Recurrence) =>
		a?.interval === b.interval && a.unit === b.unit && !(a.unit === 'week' && a.days);
</script>

<Popover label="Repeat">
	{#snippet trigger({ toggle })}
		<button
			type="button"
			class="chip"
			data-active={!!recurrence}
			aria-label={recurrence ? repeatLabel(recurrence, due) : 'Set repeat'}
			onclick={toggle}
			style={recurrence ? 'color: var(--tone-tomorrow)' : ''}
		>
			<Repeat size={15} weight={recurrence ? 'bold' : 'regular'} />
			{recurrence ? formatRecurrence(recurrence, due) : 'Repeat'}
		</button>
	{/snippet}
	{#snippet children({ close })}
		<div class="w-60 touch:w-80">
			{#each PRESETS as preset (preset.unit)}
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						onchange(preset);
						close();
					}}
				>
					<span class="flex-1">{formatRecurrence(preset, anchor)}</span>
					{#if same(recurrence, preset)}<Check size={14} class="text-accent" />{/if}
				</button>
			{/each}
			{#if recurrence}
				<button
					type="button"
					class="menu-item text-muted"
					onclick={() => {
						onchange(null);
						close();
					}}
				>
					Don’t repeat
				</button>
			{/if}
			<div class="mt-1 grid grid-cols-7 border-t border-ink/5 pt-1">
				{#each WEEK as day (day)}
					<button
						type="button"
						class="group grid h-8 place-items-center disabled:cursor-default touch:h-11"
						aria-label={WEEKDAY_NAMES[day]}
						aria-pressed={weekdays.includes(day)}
						disabled={weekdays.length === 1 && weekdays[0] === day}
						onclick={() => toggleDay(day)}
					>
						<span
							class="grid size-7 place-items-center rounded-full text-[12px] font-medium text-muted transition-colors group-hover:bg-ink/5 group-active:scale-95 group-aria-pressed:bg-accent group-aria-pressed:text-on-accent touch:size-9 touch:text-[14px]"
						>
							{WEEKDAY_NAMES[day][0]}
						</span>
					</button>
				{/each}
			</div>
			<form
				class="mt-1 flex items-center gap-1.5 border-t border-ink/5 px-1 pt-2 pb-1 text-[13px] touch:text-[15px]"
				onsubmit={(e) => {
					e.preventDefault();
					if (!customValid) return;
					const days = customUnit === 'week' && recurrence?.unit === 'week' ? recurrence.days : undefined;
					onchange(days ? { interval: customInterval!, unit: 'week', days } : { interval: customInterval!, unit: customUnit });
					close();
				}}
			>
				<span class="text-muted">Every</span>
				<input type="number" min="1" max="365" aria-label="Repeat interval" class="field w-14" bind:value={customInterval} />
				<select aria-label="Repeat unit" class="field min-w-0 flex-1" bind:value={customUnit}>
					{#each UNITS as unit (unit)}<option value={unit}>{unit}s</option>{/each}
				</select>
				<button type="submit" class="btn btn-quiet px-2.5 disabled:opacity-40" disabled={!customValid}>Set</button>
			</form>
		</div>
	{/snippet}
</Popover>
