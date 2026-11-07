<script lang="ts">
	import { untrack } from 'svelte';
	import Repeat from 'phosphor-svelte/lib/Repeat';
	import Check from 'phosphor-svelte/lib/Check';
	import type { Due, Recurrence, RecurrenceUnit, Weekday } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import {
		canToggleWeekday,
		customRepeat,
		isRepeatPreset,
		MAX_CUSTOM_INTERVAL,
		REPEAT_UNITS,
		REPEAT_WEEK,
		repeatAnchor,
		repeatPresets,
		repeatWeekdays,
		setRepeat,
		toggleWeekday,
	} from 'shared/task-menus.ts';
	import { WEEKDAY_NAMES, formatRecurrence, repeatLabel } from 'shared/format.ts';
	import { clock } from '../ui.svelte.ts';

	let {
		recurrence,
		due,
		onchange,
		open = $bindable(false),
	}: {
		recurrence: Recurrence | null;
		due: Due | null;
		/** A repeat comes with the due date it starts on: the first occurrence on or after the current one, or today. */
		onchange: (recurrence: Recurrence | null, due: Due | null) => void;
		open?: boolean;
	} = $props();

	let customInterval = $state<number | null>(2);
	let customUnit = $state<RecurrenceUnit>('day');
	/** An emptied number field binds `null`, which must never reach the task. */
	const customValid = $derived(
		Number.isInteger(customInterval) && customInterval! >= 1 && customInterval! <= MAX_CUSTOM_INTERVAL,
	);

	const anchor = $derived(repeatAnchor(due, clock.today));
	const presets = $derived(repeatPresets(anchor.date));
	let opened = $state<Due | null>(null);
	$effect(() => {
		if (open) opened = untrack(() => anchor);
	});

	function set(next: Recurrence | null) {
		const stored = setRepeat(next, opened ?? anchor, due);
		onchange(stored.recurrence, stored.due);
	}

	const weekdays = $derived(repeatWeekdays(recurrence, anchor));
	const toggleDay = (day: Weekday) => set(toggleWeekday(day, recurrence, anchor));
</script>

<Popover label="Repeat" bind:open>
	{#snippet trigger({ toggle })}
		<button
			type="button"
			class="chip"
			data-active={!!recurrence}
			aria-label={recurrence ? repeatLabel(recurrence, due) : 'Set repeat'}
			onclick={toggle}
			style={recurrence ? 'color: var(--tone-repeat)' : ''}
		>
			<Repeat size={15} weight={recurrence ? 'bold' : 'regular'} />
			{recurrence ? formatRecurrence(recurrence, due) : 'Repeat'}
		</button>
	{/snippet}
	{#snippet children({ close })}
		<div class="w-60 touch:w-80">
			<div class="mb-1 grid grid-cols-7 border-b border-ink/5 pb-1">
				{#each REPEAT_WEEK as day (day)}
					<button
						type="button"
						class="grid h-8 place-items-center touch:h-11"
						aria-label={WEEKDAY_NAMES[day]}
						aria-pressed={weekdays.includes(day)}
						disabled={!canToggleWeekday(day, weekdays)}
						onclick={() => toggleDay(day)}
					>
						<span
							class={['btn size-7 p-0 touch:size-9', weekdays.includes(day) ? 'btn-primary' : 'btn-quiet']}
						>
							{WEEKDAY_NAMES[day][0]}
						</span>
					</button>
				{/each}
			</div>
			{#each presets as preset, i (i)}
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						set(preset);
						close();
					}}
				>
					<span class="flex-1">{formatRecurrence(preset, anchor)}</span>
					{#if isRepeatPreset(preset, recurrence)}<Check size={14} class="text-accent" />{/if}
				</button>
			{/each}
			{#if recurrence}
				<button
					type="button"
					class="menu-item text-muted"
					onclick={() => {
						set(null);
						close();
					}}
				>
					Don’t repeat
				</button>
			{/if}
			<form
				class="mt-1 flex items-center gap-1.5 border-t border-ink/5 px-1 pt-2 pb-1 text-[13px] touch:text-[15px]"
				onsubmit={(e) => {
					e.preventDefault();
					if (!customValid) return;
					set(customRepeat(recurrence, customInterval!, customUnit));
					close();
				}}
			>
				<span class="text-muted">Every</span>
				<input type="number" min="1" max={MAX_CUSTOM_INTERVAL} aria-label="Repeat interval" class="field w-14" bind:value={customInterval} />
				<select aria-label="Repeat unit" class="field min-w-0 flex-1" bind:value={customUnit}>
					{#each REPEAT_UNITS as unit (unit)}<option value={unit}>{unit}s</option>{/each}
				</select>
				<button type="submit" class="btn btn-quiet px-2.5 disabled:opacity-40" disabled={!customValid}>Set</button>
			</form>
		</div>
	{/snippet}
</Popover>
