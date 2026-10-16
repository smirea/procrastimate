<script lang="ts">
	import { page } from '$app/state';
	import { tick, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Hash from 'phosphor-svelte/lib/Hash';
	import { projectTasks } from 'shared/views.ts';
	import { store } from '../store.svelte.ts';
	import { motion } from '../ui.svelte.ts';

	let { children }: { children?: Snippet } = $props();

	/** A mouse lifts a row once it moves this far, so a click still navigates. */
	const MOUSE_SLOP = 4;
	/** A finger lifts a row after holding it this long, and moving further first scrolls instead. */
	const LONG_PRESS_MS = 350;
	const TOUCH_SLOP = 8;

	type Press = { id: string; index: number; pointerId: number; startX: number; startY: number; touch: boolean; timer?: number };
	type Drag = { id: string; dy: number; from: number; to: number; mids: number[]; step: number };

	const projects = $derived(store.ownProjects);
	let list: HTMLUListElement;
	let press: Press | null = null;
	let drag = $state<Drag | null>(null);
	let settling = $state(false);

	$effect(() => {
		// Svelte adds touch listeners as passive, and only a non-passive one can stop the page scrolling under a drag.
		const hold = (event: TouchEvent) => {
			if (drag) event.preventDefault();
		};
		list.addEventListener('touchmove', hold, { passive: false });
		return () => list.removeEventListener('touchmove', hold);
	});

	function onpointerdown(event: PointerEvent, id: string, index: number) {
		if (event.button !== 0 || projects.length < 2 || press || settling) return;
		const touch = event.pointerType !== 'mouse';
		press = { id, index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, touch };
		if (touch) press.timer = window.setTimeout(lift, LONG_PRESS_MS);
		window.addEventListener('pointermove', onpointermove);
		window.addEventListener('pointerup', onpointerup);
		window.addEventListener('pointercancel', onpointercancel);
	}

	function lift() {
		if (!press) return;
		const rects = [...list.querySelectorAll('[data-project-id]')].map((row) => row.getBoundingClientRect());
		const step = rects.length > 1 ? rects[1]!.top - rects[0]!.top : rects[press.index]!.height;
		drag = { id: press.id, dy: 0, from: press.index, to: press.index, mids: rects.map((r) => r.top + r.height / 2), step };
		if (press.touch) navigator.vibrate?.(8);
	}

	function onpointermove(event: PointerEvent) {
		if (event.pointerId !== press?.pointerId) return;
		const dy = event.clientY - press.startY;
		if (!drag) {
			if (press.touch) {
				if (Math.hypot(event.clientX - press.startX, dy) > TOUCH_SLOP) release();
				return;
			}
			if (Math.abs(dy) < MOUSE_SLOP) return;
			lift();
		}
		const current = drag!;
		// Half a step past either end, so the center can cross the first or last row's midpoint and take its slot.
		const reach = (slots: number) => (slots + 0.5) * current.step;
		current.dy = Math.max(-reach(current.from), Math.min(dy, reach(projects.length - 1 - current.from)));
		const center = current.mids[current.from]! + current.dy;
		current.to = current.mids.filter((mid, i) => i !== current.from && mid < center).length;
	}

	function onpointerup(event: PointerEvent) {
		if (event.pointerId === press?.pointerId) void drop(true);
	}

	function onpointercancel(event: PointerEvent) {
		if (event.pointerId === press?.pointerId) void drop(false);
	}

	function release() {
		window.clearTimeout(press?.timer);
		press = null;
		window.removeEventListener('pointermove', onpointermove);
		window.removeEventListener('pointerup', onpointerup);
		window.removeEventListener('pointercancel', onpointercancel);
	}

	async function drop(commit: boolean) {
		release();
		const ended = drag;
		if (!ended) return;
		swallowClick();
		const row = () => list.querySelector(`[data-project-id="${ended.id}"]`);
		const lifted = row()?.getBoundingClientRect().top ?? 0;
		settling = true;
		drag = null;
		if (commit && ended.to !== ended.from) store.moveProject(ended.id, ended.to);
		await tick();
		const landed = row();
		const residual = lifted - (landed?.getBoundingClientRect().top ?? lifted);
		landed?.animate([{ transform: `translateY(${residual}px)` }, { transform: 'none' }], {
			duration: 200,
			easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
		});
		settling = false;
	}

	/** The pointer that ends a drag must not also open the project it lifted. */
	function swallowClick() {
		const swallow = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener('click', swallow, { capture: true, once: true });
		setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
	}

	function offset(index: number, id: string) {
		if (!drag) return 0;
		if (id === drag.id) return drag.dy;
		if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.step;
		if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.step;
		return 0;
	}

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
</script>

<ul bind:this={list} class="relative space-y-0.5">
	{#each projects as project, index (project.id)}
		{@const href = `/projects/${project.id}`}
		{@const active = page.url.pathname === href}
		{@const count = projectTasks(store.own.tasks, project.id).length}
		<li
			data-project-id={project.id}
			class="relative rounded-full"
			class:lifted={drag?.id === project.id}
			class:shifting={!!drag && drag.id !== project.id}
			style:transform={drag ? `translateY(${offset(index, project.id)}px)` : undefined}
			animate:flip={motion({ duration: settling ? 0 : 220, easing: cubicOut })}
			transition:slide={motion({ duration: 180, easing: cubicOut })}
		>
			<a
				{href}
				class="nav-link"
				class:active
				aria-current={active ? 'page' : undefined}
				aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
				draggable="false"
				onpointerdown={(e) => onpointerdown(e, project.id, index)}
				onkeydown={(e) => moveByKey(e, project.id, index)}
				oncontextmenu={(e) => {
					if (press || drag) e.preventDefault();
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
