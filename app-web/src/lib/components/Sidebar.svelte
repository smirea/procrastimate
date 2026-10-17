<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Tray from 'phosphor-svelte/lib/Tray';
	import CalendarMinus from 'phosphor-svelte/lib/CalendarMinus';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Tag from 'phosphor-svelte/lib/Tag';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import CalendarStar from 'phosphor-svelte/lib/CalendarStar';
	import PlusCircle from 'phosphor-svelte/lib/PlusCircle';
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import GearSix from 'phosphor-svelte/lib/GearSix';
	import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
	import Popover from './Popover.svelte';
	import PersonName from './PersonName.svelte';
	import ProjectList from './ProjectList.svelte';
	import Settings from './Settings.svelte';
	import { store } from '../store.svelte.ts';
	import { labelStyle } from '../label-colors.ts';
	import { clock, mobile, motion, sheets } from '../ui.svelte.ts';
	import { sharedEntries } from '../spaces.ts';
	import { inboxTasks, labelViewTasks, todayTasks } from 'shared/views.ts';
	import { eventGroups, placeGroups } from 'shared/triggers.ts';

	let { onquickadd, onsearch, onsettings }: { onquickadd: () => void; onsearch: () => void; onsettings: () => void } =
		$props();

	const today = $derived(todayTasks(store.own.tasks, clock.today));
	const noDate = $derived(inboxTasks(store.own.tasks, clock.today).length);
	/** No date leaves the list once it is empty, but not while it is open, so finishing its last task keeps the page's link. */
	const views = $derived([
		{ href: '/inbox', label: 'Inbox', icon: Tray, count: today.overdue.length + today.today.length },
		...(noDate || page.url.pathname === '/no-date' ? [{ href: '/no-date', label: 'No date', icon: CalendarMinus, count: noDate }] : []),
		{ href: '/completed', label: 'Completed', icon: CheckCircle, count: 0 },
	]);

	const labels = $derived(
		store.own.labels
			.map((label) => ({ label, count: labelViewTasks(store.own.tasks, label).length }))
			.toSorted((a, b) => a.label.name.localeCompare(b.label.name, undefined, { sensitivity: 'base' })),
	);

	const sections = $derived([
		{
			label: 'Places',
			icon: MapPin,
			rows: placeGroups(store.own.tasks, store.own.labels).map((g) => ({ key: g.key, name: g.name, count: g.count, href: `/places/${encodeURIComponent(g.key)}` })),
		},
		{
			label: 'Events',
			icon: CalendarStar,
			rows: eventGroups(store.own.tasks, clock.today).map((g) => ({ key: g.id, name: g.title, count: g.count, href: `/events/${encodeURIComponent(g.id)}` })),
		},
	]);

	const shared = $derived(sharedEntries(store.spaces));

	let adding = $state(false);
	let name = $state('');

	function createProject() {
		const trimmed = name.trim();
		if (!trimmed) {
			adding = false;
			return;
		}
		const project = store.addProject(trimmed);
		name = '';
		adding = false;
		void goto(`/projects/${project.id}`);
	}
</script>

<nav class="glass flex h-full flex-col rounded-panel p-3" aria-label="Main">
	<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain">
		<div class="flex items-center justify-between px-2 pt-1">
			<span class="text-[15px] font-semibold tracking-tight">ProcrastiMate</span>
		</div>

		<div class="space-y-0.5">
			<button type="button" class="menu-item h-9 rounded-full font-medium text-accent touch:h-11" onclick={onquickadd}>
				<PlusCircle size={20} weight="fill" />
				Add task
				<kbd class="ml-auto rounded-full bg-ink/[0.06] px-2 text-[11px] font-normal text-faint touch:hidden">Q</kbd>
			</button>
			<button type="button" class="menu-item h-9 touch:h-11" onclick={onsearch}>
				<MagnifyingGlass size={20} class="text-muted" />
				Search
				<kbd class="ml-auto rounded-full bg-ink/[0.06] px-2 text-[11px] font-normal text-faint touch:hidden">/</kbd>
			</button>
		</div>

		<ul class="space-y-0.5">
			{#each views as view (view.href)}
				{@const active = page.url.pathname === view.href}
				<li transition:slide={motion({ duration: 180, easing: cubicOut })}>
					<a href={view.href} class="nav-link" class:active aria-current={active ? 'page' : undefined}>
						<view.icon size={18} weight={active ? 'fill' : 'regular'} />
						<span class="flex-1">{view.label}</span>
						{#if view.count}<span class="text-[12px] text-faint">{view.count}</span>{/if}
					</a>
				</li>
			{/each}
		</ul>

		<section aria-label="Projects">
			<div class="flex items-center justify-between px-2 pb-1">
				<h2 class="text-[12px] font-medium tracking-wide text-faint uppercase">Projects</h2>
				<button type="button" class="icon-btn size-7 touch:size-11" aria-label="Add project" onclick={() => (adding = true)}>
					<Plus size={14} weight="bold" />
				</button>
			</div>
			<ProjectList>
				{#if adding}
					<li transition:slide={motion({ duration: 180, easing: cubicOut })}>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="field h-9 w-full rounded-full px-3 touch:h-11"
							aria-label="Project name"
							placeholder="Project name"
							autofocus
							bind:value={name}
							onblur={createProject}
							onkeydown={(e) => {
								if (e.key === 'Enter') createProject();
								if (e.key === 'Escape') {
									name = '';
									adding = false;
								}
							}}
						/>
					</li>
				{/if}
			</ProjectList>
		</section>

		{#each sections as section (section.label)}
			{#if section.rows.length}
				<section aria-label={section.label} transition:slide={motion({ duration: 180, easing: cubicOut })}>
					<h2 class="px-2 pb-1 text-[12px] font-medium tracking-wide text-faint uppercase">{section.label}</h2>
					<ul class="space-y-0.5">
						{#each section.rows as row (row.key)}
							{@const active = page.url.pathname === row.href}
							<li transition:slide={motion({ duration: 180, easing: cubicOut })}>
								<a href={row.href} class="nav-link" class:active aria-current={active ? 'page' : undefined}>
									<section.icon size={18} weight={active ? 'fill' : 'regular'} class={active ? '' : 'text-muted'} />
									<span class="flex-1 truncate">{row.name}</span>
									<span class="text-[12px] text-faint">{row.count}</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}

		{#if shared.length}
			<section aria-label="Shared with me" transition:slide={motion({ duration: 180, easing: cubicOut })}>
				<h2 class="px-2 pb-1 text-[12px] font-medium tracking-wide text-faint uppercase">Shared with me</h2>
				<ul class="space-y-0.5">
					{#each shared as entry (entry.id)}
						{@const href = entry.kind === 'task' ? null : `/${entry.kind}s/${entry.id}`}
						{@const active = href !== null && page.url.pathname === href}
						{@const Icon = entry.kind === 'project' ? Hash : entry.kind === 'label' ? Tag : CheckCircle}
						{#snippet row()}
							{@const color = entry.kind === 'label' ? store.label(entry.id)?.color : undefined}
							<Icon size={18} weight={active ? 'fill' : 'regular'} class={color ? 'text-[var(--label-tone)]' : active ? '' : 'text-muted'} style={color ? labelStyle(color) : undefined} />
							<span class="min-w-0 flex-1 truncate">{entry.name}</span>
							<PersonName person={entry.owner} class="max-w-[45%] text-[12px] text-faint" />
						{/snippet}
						<li transition:slide={motion({ duration: 180, easing: cubicOut })}>
							{#if href}
								<a {href} class="nav-link" class:active aria-current={active ? 'page' : undefined}>{@render row()}</a>
							{:else}
								<button type="button" class="nav-link w-full text-left" onclick={() => sheets.openTask(entry.id)}>{@render row()}</button>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if labels.length}
			<section aria-label="Labels" transition:slide={motion({ duration: 180, easing: cubicOut })}>
				<h2 class="px-2 pb-1 text-[12px] font-medium tracking-wide text-faint uppercase">Labels</h2>
				<ul class="space-y-0.5">
					{#each labels as { label, count } (label.id)}
						{@const href = `/labels/${label.id}`}
						{@const Icon = label.place ? MapPin : Tag}
						{@const active = page.url.pathname === href}
						<li transition:slide={motion({ duration: 180, easing: cubicOut })}>
							<a {href} class="nav-link" class:active aria-current={active ? 'page' : undefined}>
								<Icon size={18} weight={active ? 'fill' : 'regular'} class="text-[var(--label-tone)]" style={labelStyle(label.color)} />
								<span class="flex-1 truncate">{label.name}</span>
								{#if count}<span class="text-[12px] text-faint">{count}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>

	<!-- Outside the scrolling area, which would clip the settings popover. -->
	<div class="space-y-0.5 pt-2">
		{#if mobile.current}
			<button type="button" class="menu-item h-9 touch:h-11 touch:text-[15px]" onclick={onsettings}>
				<GearSix size={20} class="text-muted" />
				Settings
			</button>
		{:else}
			<Popover label="Settings">
				{#snippet trigger({ open, toggle })}
					<button type="button" class="menu-item h-9 touch:h-11" aria-haspopup="dialog" aria-expanded={open} onclick={toggle}>
						<GearSix size={20} weight={open ? 'fill' : 'regular'} class="text-muted" />
						Settings
					</button>
				{/snippet}
				<Settings />
			</Popover>
		{/if}
	</div>
</nav>
