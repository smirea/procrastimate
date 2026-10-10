<script lang="ts">
	import Bell from 'phosphor-svelte/lib/Bell';
	import X from 'phosphor-svelte/lib/X';
	import type { DateKey, Due, Reminder, TimeOfDay } from 'shared/task.ts';
	import Popover from './Popover.svelte';
	import { formatReminder } from '../format.ts';
	import { clock } from '../ui.svelte.ts';

	let {
		reminders,
		due,
		onchange,
		label = 'Reminders',
	}: { reminders: Reminder[]; due: Due | null; onchange: (reminders: Reminder[]) => void; label?: string } = $props();

	const PRESETS = [0, 10, 30, 60, 1440];
	let customDate = $state('');
	let customTime = $state('09:00');

	const sameReminder = (a: Reminder, b: Reminder) => JSON.stringify(a) === JSON.stringify(b);

	function add(reminder: Reminder) {
		if (reminders.some((r) => sameReminder(r, reminder))) return;
		onchange([...reminders, reminder]);
	}

	function remove(index: number) {
		onchange(reminders.filter((_, i) => i !== index));
	}

	const presetLabel = (minutes: number) => formatReminder({ kind: 'before', minutes }, clock.today);
</script>

<Popover {label}>
	{#snippet trigger({ toggle })}
		<button
			type="button"
			class="chip"
			data-active={reminders.length > 0}
			aria-label={reminders.length ? `${reminders.length} reminder${reminders.length > 1 ? 's' : ''}` : 'Add reminder'}
			onclick={toggle}
		>
			<Bell size={15} weight={reminders.length ? 'fill' : 'regular'} />
			{reminders.length ? `${reminders.length}` : 'Remind'}
		</button>
	{/snippet}
	{#snippet children({ close })}
		<div class="w-64">
			{#each reminders as reminder, i (JSON.stringify(reminder))}
				<div class="flex h-8 items-center gap-2 rounded-xl px-2 text-[13px] touch:h-11 touch:text-[15px]">
					<Bell size={14} class="text-[var(--tone-week)]" weight="fill" />
					<span class="flex-1">{formatReminder(reminder, clock.today)}</span>
					<button type="button" class="icon-btn hit-area size-7 touch:size-9" aria-label="Remove reminder" onclick={() => remove(i)}>
						<X size={12} weight="bold" />
					</button>
				</div>
			{/each}
			{#if reminders.length}<div class="my-1 border-t border-ink/5"></div>{/if}
			<div class="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-faint uppercase">
				{due?.time ? 'Before due time' : 'Before due time · needs a time'}
			</div>
			{#each PRESETS as minutes (minutes)}
				<button type="button" class="menu-item disabled:opacity-40" disabled={!due?.time} onclick={() => {
						add({ kind: 'before', minutes });
						close();
					}}>
					{presetLabel(minutes)}
				</button>
			{/each}
			<div class="mt-1 border-t border-ink/5 px-1 pt-2 pb-1">
				<div class="flex gap-1.5">
					<input type="date" aria-label="Reminder date" class="field flex-1" bind:value={customDate} />
					<input type="time" aria-label="Reminder time" class="field w-24" bind:value={customTime} />
				</div>
				<button
					type="button"
					class="btn btn-quiet mt-1.5 w-full"
					disabled={!customTime}
					onclick={() => {
						add({ kind: 'at', date: (customDate || due?.date || clock.today) as DateKey, time: customTime as TimeOfDay });
						close();
					}}
				>
					Add reminder
				</button>
			</div>
		</div>
	{/snippet}
</Popover>
