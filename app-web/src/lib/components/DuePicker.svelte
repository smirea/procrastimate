<script lang="ts">
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import { addDays, fromDateKey, toTimeOfDay, type DateKey, type Due, type TimeOfDay } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import KeepAsText from './KeepAsText.svelte';
	import { dueTone, formatDue } from '../format.ts';
	import { clock } from '../ui.svelte.ts';

	let {
		due,
		onchange,
		onkeepastext,
	}: { due: Due | null; onchange: (due: Due | null) => void; onkeepastext?: () => void } = $props();

	const today = $derived(clock.today);
	const nextMonday = $derived(addDays(today, ((8 - fromDateKey(today).getDay()) % 7) || 7));

	const presets = $derived([
		{ label: 'Today', date: today },
		{ label: 'Tomorrow', date: addDays(today, 1) },
		{ label: 'Next week', date: nextMonday },
	]);

	function setDate(date: DateKey | '') {
		onchange(date ? { date, time: due?.time ?? null } : null);
	}

	function setTime(time: string) {
		const date = due?.date ?? today;
		onchange({ date, time: (time || null) as TimeOfDay | null });
	}
</script>

<div class="flex items-center">
	<Popover label="Due date">
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
			{#each presets as preset (preset.label)}
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						setDate(preset.date);
						close();
					}}
				>
					{preset.label}
				</button>
			{/each}
			{#if due}
				<button
					type="button"
					class="menu-item text-muted"
					onclick={() => {
						onchange(null);
						close();
					}}
				>
					No date
				</button>
			{/if}
			<div class="mt-1 flex gap-1.5 border-t border-black/5 px-1 pt-2 pb-1">
				<input
					type="date"
					aria-label="Due date"
					class="field flex-1"
					value={due?.date ?? ''}
					onchange={(e) => setDate(e.currentTarget.value as DateKey | '')}
				/>
				<input
					type="time"
					aria-label="Due time"
					class="field w-28"
					value={due?.time ?? ''}
					onchange={(e) => setTime(e.currentTarget.value)}
				/>
			</div>
			{#if !due?.time}
				<button type="button" class="menu-item text-muted" onclick={() => setTime(toTimeOfDay(9, 0))}>Add time</button>
			{/if}
		{/snippet}
	</Popover>
	{#if onkeepastext}<KeepAsText onclick={onkeepastext} />{/if}
</div>
