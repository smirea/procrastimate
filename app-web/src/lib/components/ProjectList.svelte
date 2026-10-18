<script lang="ts">
	import { page } from '$app/state';
	import { tick, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Hash from 'phosphor-svelte/lib/Hash';
	import { openCounts } from 'shared/views.ts';
	import { store } from '../store.svelte.ts';
	import { motion } from '../ui.svelte.ts';
	import { Reorder } from '../reorder.svelte.ts';

	let { children }: { children?: Snippet } = $props();

	const projects = $derived(store.ownProjects);
	let list: HTMLUListElement;
	const reorder = new Reorder({ key: 'data-project-id', lift: 'hold', count: () => projects.length, move: (id, to) => store.moveProject(id, to) });

	async function moveByKey(event: KeyboardEvent, id: string, index: number) {
		if (!event.altKey) return;
		const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
		if (to === null) return;
		event.preventDefault();
		if (to < 0 || to >= projects.length) return;
		store.moveProject(id, to);
		await tick();
		list.querySelector<HTMLElement>(`[data-project-id="${id}"] a`)?.focus();
	}

	const counts = $derived(openCounts(store.own.tasks, store.own.labels));
</script>

<ul bind:this={list} {@attach reorder.list} class="relative space-y-0.5">
	{#each projects as project, index (project.id)}
		{@const href = `/projects/${project.id}`}
		{@const active = page.url.pathname === href}
		{@const count = counts.projects.get(project.id) ?? 0}
		<li
			data-project-id={project.id}
			class="relative rounded-full"
			class:lifted={reorder.drag?.id === project.id}
			class:shifting={!!reorder.drag && reorder.drag.id !== project.id}
			style:transform={reorder.drag ? `translateY(${reorder.offset(index, project.id)}px)` : undefined}
			animate:flip={motion({ duration: reorder.settling ? 0 : 220, easing: cubicOut })}
			transition:slide={motion({ duration: 180, easing: cubicOut })}
		>
			<a
				{href}
				class="nav-link"
				class:active
				aria-current={active ? 'page' : undefined}
				aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
				draggable="false"
				onpointerdown={(e) => reorder.start(e, project.id, index)}
				onkeydown={(e) => moveByKey(e, project.id, index)}
				oncontextmenu={(e) => {
					if (reorder.busy) e.preventDefault();
				}}
			>
				<Hash size={18} />
				<span class="flex-1 truncate">{project.name}</span>
				{#if count}<span class="text-[12px] text-faint">{count}</span>{/if}
			</a>
		</li>
	{/each}
	{@render children?.()}
</ul>

<style>
	li {
		-webkit-touch-callout: none;
		user-select: none;
	}

	.shifting {
		transition: transform 200ms var(--ease-spring);
	}

	.lifted {
		z-index: 10;
		cursor: grabbing;
		scale: 1.02;
		background: var(--color-surface);
		box-shadow: 0 8px 24px -8px color-mix(in srgb, var(--color-ink) 25%, transparent);
	}
</style>
