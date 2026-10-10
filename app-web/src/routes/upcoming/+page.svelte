<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import View from '#lib/components/View.svelte';
	import TaskList from '#lib/components/TaskList.svelte';
	import { store } from '#lib/store.svelte.ts';
	import { clock } from '#lib/ui.svelte.ts';
	import { upcomingGroups } from '#lib/views.ts';
	import { dayHeading } from '#lib/format.ts';

	const groups = $derived(upcomingGroups(store.tasks, clock.today));
</script>

<svelte:head><title>Upcoming · Procrastimate</title></svelte:head>

<View
	title="Upcoming"
	empty={groups.length === 0}
	emptyTitle="Nothing scheduled"
	emptyHint="Tasks due after today show up here, grouped by day."
	quickAdd={{ projectId: null, today: false }}
>
	{#each groups as group (group.date)}
		<section class="mb-6" aria-label={dayHeading(group.date, clock.today)} animate:flip={{ duration: 240, easing: cubicOut }} transition:fade={{ duration: 160 }}>
			<h2 class="mb-1 border-b border-ink/[0.07] px-2 pb-1.5 text-[13px] font-semibold">{dayHeading(group.date, clock.today)}</h2>
			<TaskList tasks={group.tasks} showProject timeOnly label={`Tasks on ${group.date}`} />
		</section>
	{/each}
</View>
