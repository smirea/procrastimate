<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import DotsSixVertical from 'phosphor-svelte/lib/DotsSixVertical';
	import { moveButton, rowButtons, toggleButton } from 'shared/quick-add-buttons.ts';
	import { BUTTON_INFO, WEB_BUTTONS, type WebButton } from '../quick-add-buttons.ts';
	import { Reorder } from '../reorder.svelte.ts';
	import { store } from '../store.svelte.ts';
	import { motion } from '../ui.svelte.ts';

	const buttons = $derived(rowButtons(store.quickAddButtons, WEB_BUTTONS, WEB_BUTTONS) as WebButton[]);
	const pinned = $derived(buttons.filter((button) => store.quickAddButtons.includes(button)));
	let list: HTMLUListElement;
	const reorder = new Reorder({ key: 'data-quick-add-button', lift: 'handle', count: () => pinned.length, move });

	function move(button: string, to: number) {
		const rest = pinned.filter((b) => b !== button);
		store.setQuickAddButtons(moveButton(store.quickAddButtons, button as WebButton, rest[to] ?? null));
	}

	async function moveByKey(event: KeyboardEvent, button: WebButton, index: number) {
		const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
		if (to === null) return;
		event.preventDefault();
		if (to < 0 || to >= pinned.length) return;
		move(button, to);
		await tick();
		list.querySelector<HTMLElement>(`[data-quick-add-button="${button}"] [data-handle]`)?.focus();
	}
</script>

<ul bind:this={list} {@attach reorder.list} class="relative -mx-1.5" role="group" aria-label="Quick add buttons">
	{#each buttons as button, index (button)}
		{@const { name, icon: Icon } = BUTTON_INFO[button]}
		{@const shown = index < pinned.length}
		<li
			data-quick-add-button={shown ? button : undefined}
			class="relative flex items-center rounded-xl"
			class:glass-strong={reorder.drag?.id === button}
			class:lifted={reorder.drag?.id === button}
			class:shifting={!!reorder.drag && reorder.drag.id !== button}
			style:transform={reorder.drag && shown ? `translateY(${reorder.offset(index, button)}px)` : undefined}
			animate:flip={motion({ duration: reorder.settling ? 0 : 220, easing: cubicOut })}
		>
			<button
				type="button"
				class="menu-item min-w-0 flex-1 touch:h-11 touch:text-[15px]"
				aria-pressed={shown}
				onclick={() => store.setQuickAddButtons(toggleButton(store.quickAddButtons, button))}
			>
				<Icon size={16} weight={shown ? 'fill' : 'regular'} class={shown ? 'text-accent' : 'text-faint'} />
				<span class={['flex-1 truncate', !shown && 'text-muted']}>{name}</span>
			</button>
			{#if shown && pinned.length > 1}
				<button
					type="button"
					data-handle
					aria-label={`Reorder ${name}`}
					title="Drag, or use the arrow keys, to reorder"
					class="handle hit-area relative grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-faint transition-colors hover:text-muted touch:size-11"
					onpointerdown={(e) => reorder.start(e, button, index)}
					onkeydown={(e) => moveByKey(e, button, index)}
				>
					<DotsSixVertical size={16} weight="bold" />
				</button>
			{/if}
		</li>
	{/each}
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
	}

	.lifted .handle {
		cursor: grabbing;
	}
</style>
