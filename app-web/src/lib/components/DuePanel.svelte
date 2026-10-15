<script lang="ts">
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import CalendarDot from 'phosphor-svelte/lib/CalendarDot';
	import CalendarPlus from 'phosphor-svelte/lib/CalendarPlus';
	import Clock from 'phosphor-svelte/lib/Clock';
	import Prohibit from 'phosphor-svelte/lib/Prohibit';
	import Sun from 'phosphor-svelte/lib/Sun';
	import X from 'phosphor-svelte/lib/X';
	import type { Component } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import {
		addDays,
		dueAtTime,
		fromDateKey,
		mondayIndex,
		toTimeOfDay,
		weekdayOf,
		type DateKey,
		type Due,
		type TimeOfDay,
	} from 'shared/task.ts';
	import { formatDate, formatTime } from 'shared/format.ts';
	import { resolveTime } from 'shared/quick-add.ts';
	import Calendar from './Calendar.svelte';
	import { clock, mobile, motion } from '../ui.svelte.ts';

	let { due, onchange, close }: { due: Due | null; onchange: (due: Due | null) => void; close: () => void } = $props();

	const SLOTS = Array.from({ length: 48 }, (_, i) => toTimeOfDay(Math.floor(i / 2), (i % 2) * 30));

	let view = $state<'date' | 'time'>('date');
	let typed = $state('');
	let invalid = $state(false);

	const today = $derived(clock.today);
	const now = $derived.by(() => {
		const date = new Date(clock.now);
		return toTimeOfDay(date.getHours(), date.getMinutes());
	});

	const presets: { label: string; date: DateKey; icon: Component; tone: string }[] = $derived([
		{ label: 'Today', date: today, icon: CalendarDot, tone: 'today' },
		{ label: 'Tomorrow', date: addDays(today, 1), icon: Sun, tone: 'soon' },
		{ label: 'Next week', date: addDays(today, 7 - mondayIndex(weekdayOf(today))), icon: CalendarPlus, tone: 'week' },
	]);

	const shortDay = (date: DateKey) =>
		fromDateKey(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

	/** The slot the time list opens on: the set time, 9am on a later day, or the first one still ahead today. */
	const anchor = $derived.by(() => {
		if (due?.time) return due.time;
		if (due && due.date > today) return toTimeOfDay(9, 0);
		return SLOTS.find((slot) => slot >= now) ?? SLOTS[0]!;
	});

	function pickDate(date: DateKey) {
		onchange({ date, time: due?.time ?? null });
	}

	function pickTime(time: TimeOfDay) {
		onchange(dueAtTime(due, time, today, now));
		close();
	}

	function submitTyped(event: SubmitEvent) {
		event.preventDefault();
		const time = resolveTime(typed);
		invalid = !time;
		if (time) pickTime(time);
	}

	function scrollToAnchor(list: HTMLElement) {
		const target = list.querySelector<HTMLElement>(`[data-slot="${anchor}"]`);
		if (target) list.scrollTop = target.offsetTop - list.offsetTop - 4;
	}

	function focusUnlessTouch(input: HTMLInputElement) {
		if (!mobile.current && !matchMedia('(pointer: coarse)').matches) input.focus();
	}
</script>

<div class="w-72 touch:w-[19.75rem]">
	<div class="grid grid-cols-4 gap-1.5 p-0.5">
		{#each presets as preset (preset.label)}
			<button
				type="button"
				class="tile press"
				style="--tone: var(--tone-{preset.tone})"
				data-current={due?.date === preset.date}
				title={shortDay(preset.date)}
				onclick={() => {
					pickDate(preset.date);
					close();
				}}
			>
				<preset.icon size={18} weight="duotone" style="color: var(--tone)" />
				{preset.label}
			</button>
		{/each}
		<button
			type="button"
			class="tile press text-muted disabled:opacity-40"
			disabled={!due}
			onclick={() => {
				onchange(null);
				close();
			}}
		>
			<Prohibit size={18} />
			No date
		</button>
	</div>

	<div class="mt-1 border-t border-ink/5 pt-2"></div>

	<div class="relative">
		<div
			class="transition-opacity duration-150"
			class:opacity-0={view === 'time'}
			class:pointer-events-none={view === 'time'}
			inert={view === 'time'}
		>
			<Calendar selected={due?.date ?? null} {today} onpick={pickDate} />
			<div class="mt-1 flex items-center gap-1 border-t border-ink/5 pt-1">
				<button
					type="button"
					class="menu-item flex-1"
					aria-label={due?.time ? `Change time, ${formatTime(due.time)}` : 'Add time'}
					onclick={() => (view = 'time')}
				>
					<Clock size={16} weight={due?.time ? 'fill' : 'regular'} class={due?.time ? 'text-accent' : 'text-muted'} />
					{#if due?.time}
						<span>{formatTime(due.time)}</span>
					{:else}
						<span class="text-muted">Add time</span>
					{/if}
				</button>
				{#if due?.time}
					<button
						type="button"
						class="icon-btn hit-area size-8 shrink-0 touch:size-11"
						aria-label="Remove time"
						onclick={() => onchange({ date: due.date, time: null })}
						transition:fly={motion({ x: 6, duration: 160, easing: cubicOut })}
					>
						<X size={12} weight="bold" />
					</button>
				{/if}
			</div>
		</div>

		{#if view === 'time'}
			<div
				class="absolute inset-0 flex flex-col"
				role="group"
				aria-label="Due time"
				in:fly={motion({ x: 16, duration: 200, easing: cubicOut, opacity: 0 })}
			>
				<div class="flex items-center gap-1 pb-1">
					<button type="button" class="icon-btn size-8 touch:size-11" aria-label="Back to calendar" onclick={() => (view = 'date')}>
						<ArrowLeft size={14} weight="bold" />
					</button>
					<span class="flex-1 text-[13px] font-semibold touch:text-[15px]">Time</span>
					{#if due}
						<span class="pr-2 text-xs text-faint touch:text-[13px]">{formatDate(due.date, today)}</span>
					{/if}
				</div>
				<form class="px-1 pb-1.5" onsubmit={submitTyped}>
					<input
						class="field w-full"
						class:invalid
						aria-label="Type a time"
						aria-invalid={invalid}
						placeholder="Type a time, like 5:30pm"
						autocomplete="off"
						enterkeyhint="done"
						bind:value={typed}
						oninput={() => (invalid = false)}
						use:focusUnlessTouch
					/>
				</form>
				<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1" use:scrollToAnchor>
					{#each SLOTS as slot (slot)}
						<button
							type="button"
							data-slot={slot}
							class="menu-item tabular-nums"
							class:current={slot === due?.time}
							aria-pressed={slot === due?.time}
							onclick={() => pickTime(slot)}
						>
							{formatTime(slot)}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* Tiles instead of rows keep the popover short enough to fit above the iPhone keyboard, as on iOS. */
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1875rem;
		min-height: 3.25rem;
		border-radius: calc(var(--radius-popover) - 0.5rem);
		background: color-mix(in srgb, var(--color-ink) 5%, transparent);
		font-size: 0.75rem;
		font-weight: 500;
		white-space: nowrap;
		transition:
			background 160ms var(--ease-spring),
			scale 220ms var(--ease-spring);
	}

	.tile[data-current='true'] {
		background: color-mix(in srgb, var(--tone) 14%, transparent);
	}

	@media (hover: hover) {
		.tile:not(:disabled):hover {
			background: color-mix(in srgb, var(--color-ink) 9%, transparent);
		}
	}

	.current {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-accent);
		font-weight: 600;
	}

	.invalid,
	.invalid:focus {
		border-color: var(--tone-overdue);
	}
</style>
