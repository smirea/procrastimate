<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { ActivityEntry } from 'shared/sharing.ts';
	import { dayHeading, formatTime, relativeDay } from 'shared/format.ts';
	import { toDateKey, type Task } from 'shared/task.ts';
	import type { DateKey, TimeOfDay } from 'shared/values.ts';
	import PersonName from './PersonName.svelte';
	import { api } from '../api.ts';
	import type { Home } from 'shared/space-routing.ts';
	import { session } from '../session.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { clock, motion } from '../ui.svelte.ts';

	let { task, home }: { task: Task; home: Home } = $props();

	let entries = $state<ActivityEntry[]>([]);

	const createdBy = $derived(store.person(task.createdBy));
	const completedBy = $derived(task.completedAt === null ? undefined : store.person(task.completedBy));
	/** Only a task someone else touched has a story worth telling; a solo list stays as clean as before. */
	const shown = $derived(
		home !== null ||
			[task.createdBy, task.completedBy].some((id) => id !== null && id !== session.userId) ||
			entries.some((e) => e.actor.id !== session.userId),
	);

	/** Newest day first, each day's entries newest first, Todoist history style. */
	const days = $derived.by(() => {
		const groups: { key: DateKey; entries: ActivityEntry[] }[] = [];
		for (const entry of entries) {
			const key = toDateKey(new Date(entry.at));
			const last = groups.at(-1);
			if (last?.key === key) last.entries.push(entry);
			else groups.push({ key, entries: [entry] });
		}
		return groups;
	});

	const heading = (key: DateKey) => relativeDay(key, clock.today) ?? dayHeading(key, clock.today);

	function timeOf(at: number) {
		const date = new Date(at);
		return formatTime(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` as TimeOfDay);
	}

	onMount(async () => {
		if (!navigator.onLine) return;
		const query = home === null ? { id: task.id } : { id: task.id, space: home };
		const result = await api.activity.list({ query }).catch(() => null);
		if (!result) return;
		entries = result.entries.toReversed();
		store.rememberPeople(result.entries.map((e) => e.actor));
	});
</script>

{#if shown}
	<section class="flex flex-col gap-2 px-2" aria-label="Activity" transition:slide={motion({ duration: 180, easing: cubicOut })}>
		{#if createdBy || completedBy}
			<p class="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
				{#if createdBy}<span class="inline-flex items-center gap-1">Created by <PersonName person={createdBy} you class="text-ink" /></span>{/if}
				{#if completedBy}<span class="inline-flex items-center gap-1">Completed by <PersonName person={completedBy} you class="text-ink" /></span>{/if}
			</p>
		{/if}
		{#if entries.length}
			<h2 class="text-[12px] font-medium tracking-wide text-muted uppercase">Activity</h2>
			<div class="flex flex-col gap-3">
				{#each days as day, d (day.key)}
					<section class="flex flex-col gap-1.5" aria-label={heading(day.key)} in:fly={motion({ y: 4, duration: 180, delay: Math.min(d, 4) * 40, easing: cubicOut })}>
						<h3 class="text-[12px] font-medium text-faint">{heading(day.key)}</h3>
						<ol class="flex flex-col gap-1.5">
							{#each day.entries as entry, i (i)}
								<li class="flex items-baseline gap-2 text-[13px]">
									<p class="min-w-0 flex-1 text-muted [overflow-wrap:anywhere]">
										<PersonName person={entry.actor} you class="font-medium text-ink" />
										{entry.summary}
									</p>
									<time class="shrink-0 text-[12px] text-faint tabular-nums" datetime={new Date(entry.at).toISOString()}>{timeOf(entry.at)}</time>
								</li>
							{/each}
						</ol>
					</section>
				{/each}
			</div>
		{/if}
	</section>
{/if}
