<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Tray from 'phosphor-svelte/lib/Tray';
	import CalendarMinus from 'phosphor-svelte/lib/CalendarMinus';
	import Plus from 'phosphor-svelte/lib/Plus';
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
	import { labelIcon } from '../label-icon.ts';
	import { projectIcon } from '../project-icon.ts';
	import { clock, mobile, motion, sheets } from '../ui.svelte.ts';
	import SunHorizon from 'phosphor-svelte/lib/SunHorizon';
	import CalendarDots from 'phosphor-svelte/lib/CalendarDots';
	import { sharedEntries } from 'shared/space-routing.ts';
	import { listCatalog, type ListGroupKind, type ListKind } from 'shared/lists.ts';
	import { listHref } from '../screen.ts';

	let { onquickadd, onsearch, onsettings }: { onquickadd: () => void; onsearch: () => void; onsettings: () => void } =
		$props();

	const ICONS: Partial<Record<ListKind, typeof Tray>> = { inbox: Tray, tomorrow: SunHorizon, 'this-week': CalendarDots, 'no-date': CalendarMinus };
	const shared = $derived(Object.values(store.spaces).map(space => ({ owner: store.ownerOf(space.owner), data: space.data })));
	const catalog = $derived(listCatalog({ own: store.own, shared }, clock.today));
	const group = (kind: ListGroupKind) => catalog.find(g => g.kind === kind)!;
	const views = $derived([
		...group('lists').entries.map(entry => ({ href: listHref(entry), label: entry.name, icon: ICONS[entry.kind] ?? Tray, count: entry.count })),
		{ href: '/completed', label: 'Completed', icon: CheckCircle, count: 0 },
	]);
	const sections = $derived([
		{ group: group('places'), icon: MapPin },
		{ group: group('events'), icon: CalendarStar },
	]);
	/** Shared tasks no shared list leads to are not lists, so they follow the shared lists. */
	const sharedTasks = $derived(sharedEntries(shared).filter(entry => entry.kind === 'task'));

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
			<ProjectList projects={group('projects').entries}>
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

		{#if group('shared').entries.length || sharedTasks.length}
			<section aria-label="Shared with me" transition:slide={motion({ duration: 180, easing: cubicOut })}>
				<h2 class="px-2 pb-1 text-[12px] font-medium tracking-wide text-faint uppercase">{group('shared').title}</h2>
				<ul class="space-y-0.5">
					{#each [...group('shared').entries, ...sharedTasks] as entry (entry.id)}
						{@const href = entry.kind === 'task' ? null : listHref({ kind: entry.kind, id: entry.id })}
						{@const active = href !== null && page.url.pathname === href}
						{@const Icon = entry.kind === 'project' ? projectIcon(store.project(entry.id)) : entry.kind === 'label' ? labelIcon(store.label(entry.id)) : CheckCircle}
						{#snippet row()}
							{@const color = entry.kind === 'label' ? store.label(entry.id)?.color : undefined}
							<Icon size={18} weight={active ? 'fill' : 'regular'} class={color ? 'text-[var(--label-tone)]' : active ? '' : 'text-muted'} style={color ? labelStyle(color) : undefined} />
							<span class="min-w-0 flex-1 truncate">{entry.name}</span>
							<PersonName person={entry.owner!} class="max-w-[45%] text-[12px] text-faint" />
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

		{#each sections as { group, icon: Icon } (group.kind)}
			{#if group.entries.length}
				<section aria-label={group.title} transition:slide={motion({ duration: 180, easing: cubicOut })}>
					<h2 class="px-2 pb-1 text-[12px] font-medium tracking-wide text-faint uppercase">{group.title}</h2>
					<ul class="space-y-0.5">
						{#each group.entries as entry (entry.id)}
							{@const href = listHref(entry)}
							{@const active = page.url.pathname === href}
							<li transition:slide={motion({ duration: 180, easing: cubicOut })}>
								<a {href} class="nav-link" class:active aria-current={active ? 'page' : undefined}>
									<Icon size={18} weight={active ? 'fill' : 'regular'} class={active ? '' : 'text-muted'} />
									<span class="flex-1 truncate">{entry.name}</span>
									<span class="text-[12px] text-faint">{entry.count}</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}

		{#if group('labels').entries.length}
			<section aria-label="Labels" transition:slide={motion({ duration: 180, easing: cubicOut })}>
				<h2 class="px-2 pb-1 text-[12px] font-medium tracking-wide text-faint uppercase">{group('labels').title}</h2>
				<ul class="space-y-0.5">
					{#each group('labels').entries as entry (entry.id)}
						{@const href = listHref(entry)}
						{@const label = store.label(entry.id)}
						{@const Icon = labelIcon(label)}
						{@const active = page.url.pathname === href}
						<li transition:slide={motion({ duration: 180, easing: cubicOut })}>
							<a {href} class="nav-link" class:active aria-current={active ? 'page' : undefined}>
								<Icon size={18} weight={active ? 'fill' : 'regular'} class="text-[var(--label-tone)]" style={label ? labelStyle(label.color) : undefined} />
								<span class="flex-1 truncate">{entry.name}</span>
								{#if entry.count}<span class="text-[12px] text-faint">{entry.count}</span>{/if}
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
