<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { ActivityEntry } from 'shared/sharing.ts';
	import type { Task } from 'shared/task.ts';
	import PersonName from './PersonName.svelte';
	import { api } from '../api.ts';
	import type { Home } from '../spaces.ts';
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

	const ACTIONS: Record<ActivityEntry['action'], string> = {
		created: 'created it',
		edited: 'edited it',
		completed: 'completed it',
		reopened: 'reopened it',
		deleted: 'deleted it',
		restored: 'restored it',
	};

	const FIELD_NAMES: Record<string, string> = { projectId: 'project', labelIds: 'labels', parentId: 'parent' };

	function describe(entry: ActivityEntry) {
		if (entry.action !== 'edited' || entry.fields.length === 0) return ACTIONS[entry.action];
		return `changed ${entry.fields.map((f) => FIELD_NAMES[f] ?? f).join(', ')}`;
	}

	const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
	function ago(at: number) {
		const minutes = Math.round((at - clock.now) / 60_000);
		if (Math.abs(minutes) < 1) return 'just now';
		if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
		const hours = Math.round(minutes / 60);
		if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
		return relative.format(Math.round(hours / 24), 'day');
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
			<ol class="flex flex-col gap-1.5" aria-label="Activity list">
				{#each entries as entry, i (i)}
					<li class="flex items-baseline gap-1.5 text-[13px]" in:fly={motion({ y: 4, duration: 180, delay: Math.min(i, 6) * 30, easing: cubicOut })}>
						<PersonName person={entry.actor} you class="font-medium" />
						<span class="min-w-0 flex-1 truncate text-muted">{describe(entry)}</span>
						<time class="shrink-0 text-[12px] text-faint" datetime={new Date(entry.at).toISOString()}>{ago(entry.at)}</time>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
{/if}
