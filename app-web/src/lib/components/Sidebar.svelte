<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Tray from 'phosphor-svelte/lib/Tray';
	import CalendarCheck from 'phosphor-svelte/lib/CalendarCheck';
	import CalendarDots from 'phosphor-svelte/lib/CalendarDots';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Plus from 'phosphor-svelte/lib/Plus';
	import PlusCircle from 'phosphor-svelte/lib/PlusCircle';
	import ThemeSwitcher from './ThemeSwitcher.svelte';
	import { store } from '../store.svelte.ts';
	import { clock } from '../ui.svelte.ts';
	import { inboxTasks, projectTasks, todayTasks, upcomingGroups } from '../views.ts';

	let { onquickadd }: { onquickadd: () => void } = $props();

	const today = $derived(todayTasks(store.tasks, clock.today));
	const views = $derived([
		{ href: '/inbox', label: 'Inbox', icon: Tray, count: inboxTasks(store.tasks).length },
		{ href: '/today', label: 'Today', icon: CalendarCheck, count: today.overdue.length + today.today.length },
		{
			href: '/upcoming',
			label: 'Upcoming',
			icon: CalendarDots,
			count: upcomingGroups(store.tasks, clock.today).reduce((n, g) => n + g.tasks.length, 0),
		},
	]);

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

<nav class="glass flex h-full flex-col gap-5 overflow-y-auto overscroll-contain rounded-2xl p-3" aria-label="Main">
	<div class="flex items-center justify-between px-2 pt-1">
		<span class="text-[15px] font-semibold tracking-tight">Procrastimate</span>
	</div>

	<button type="button" class="menu-item h-9 font-medium text-accent touch:h-11" onclick={onquickadd}>
		<PlusCircle size={20} weight="fill" />
		Add task
		<kbd class="ml-auto rounded-md touch:hidden border border-ink/10 px-1.5 text-[11px] font-normal text-faint">Q</kbd>
	</button>

	<ul class="space-y-0.5">
		{#each views as view (view.href)}
			{@const active = page.url.pathname === view.href}
			<li>
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
			<button type="button" class="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink touch:size-11" aria-label="Add project" onclick={() => (adding = true)}>
				<Plus size={14} weight="bold" />
			</button>
		</div>
		<ul class="space-y-0.5">
			{#each store.projects as project (project.id)}
				{@const href = `/projects/${project.id}`}
				{@const active = page.url.pathname === href}
				<li transition:slide={{ duration: 180, easing: cubicOut }}>
					<a {href} class="nav-link" class:active aria-current={active ? 'page' : undefined}>
						<Hash size={18} />
						<span class="flex-1 truncate">{project.name}</span>
						{#if projectTasks(store.tasks, project.id).length}
							<span class="text-[12px] text-faint">{projectTasks(store.tasks, project.id).length}</span>
						{/if}
					</a>
				</li>
			{/each}
			{#if adding}
				<li transition:slide={{ duration: 180, easing: cubicOut }}>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="field h-9 w-full touch:h-11"
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
		</ul>
	</section>

	<div class="mt-auto">
		<ThemeSwitcher />
	</div>
</nav>

<style>
	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		height: 2.25rem;
		padding: 0 0.5rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-ink);
		transition:
			background 160ms var(--ease-spring),
			color 160ms var(--ease-spring);
	}

	@media (hover: hover) {
		.nav-link:hover {
			background: color-mix(in srgb, var(--color-ink) 6%, transparent);
		}
	}

	@media (max-width: 767px), (pointer: coarse) {
		.nav-link {
			height: 2.75rem;
			font-size: 0.9375rem;
		}
	}

	.nav-link.active {
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		color: var(--color-accent);
		font-weight: 500;
	}
</style>
