import type { Task } from 'shared/task.ts';

export type RowMenuTarget = {
	task: Task;
	/** A repeating task's past completion in Completed. */
	rolled?: boolean;
	/** How the row completes or reopens, so the menu's toggle plays the row's own checkbox animation. */
	toggle?: () => void;
};

type Opened = { id: string; rolled: boolean; toggle?: () => void; x: number; y: number; keyboard: boolean };

/** One menu for every row, mounted once at the root, so a long list pays nothing per row until one opens. */
class RowMenu {
	current = $state<Opened | null>(null);

	open({ task, rolled = false, toggle }: RowMenuTarget, x: number, y: number, keyboard = false) {
		this.current = { id: task.id, rolled, toggle, x, y, keyboard };
	}

	/** From the keyboard the menu drops below the focused row, with its first item focused. */
	openBelow(target: RowMenuTarget, anchor: Element) {
		const rect = anchor.getBoundingClientRect();
		this.open(target, rect.left + 24, rect.bottom, true);
	}

	close() {
		this.current = null;
	}
}

export const rowMenu = new RowMenu();

const HOLD_MS = 450;
const SLOP_PX = 10;

export const isMenuKey = (event: KeyboardEvent) =>
	event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');

/**
 * `{@attach taskMenu(() => target)}` opens the row menu on a right click, a long press on touch, and the context menu
 * key or Shift+F10 from inside the row. iOS Safari fires no `contextmenu` on a long press, so touch keeps its own
 * timer. Android fires both, and opening twice for the same row is harmless.
 */
export const taskMenu = (target: () => RowMenuTarget) => (node: HTMLElement) => {
	let hold: ReturnType<typeof setTimeout> | undefined;
	let start = { x: 0, y: 0 };
	let touch = false;
	/** The finger lifting after a long press would click the row and open its details. */
	let swallowClick = false;

	const cancel = () => clearTimeout(hold);
	/** Under a finger the menu opens below the row, which stays in view, rather than at the touch. */
	const below = () => node.getBoundingClientRect().bottom;

	function onpointerdown(event: PointerEvent) {
		swallowClick = false;
		touch = event.pointerType !== 'mouse';
		cancel();
		if (!touch || (event.target as Element).closest('[data-handle]')) return;
		start = { x: event.clientX, y: event.clientY };
		hold = setTimeout(() => {
			swallowClick = true;
			navigator.vibrate?.(10);
			rowMenu.open(target(), start.x, below());
		}, HOLD_MS);
	}

	function onpointermove(event: PointerEvent) {
		if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) cancel();
	}

	function oncontextmenu(event: MouseEvent) {
		event.preventDefault();
		cancel();
		if (rowMenu.current?.id === target().task.id) return;
		if (touch) swallowClick = true;
		rowMenu.open(target(), event.clientX, touch ? below() : event.clientY);
	}

	function onclick(event: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		event.preventDefault();
		event.stopPropagation();
	}

	function onkeydown(event: KeyboardEvent) {
		if (!isMenuKey(event)) return;
		event.preventDefault();
		rowMenu.openBelow(target(), event.target as Element);
	}

	// A long press on iOS would otherwise select the title or open a link's preview instead of the menu.
	node.style.setProperty('-webkit-touch-callout', 'none');
	node.style.userSelect = 'none';
	const listeners = new AbortController();
	const { signal } = listeners;
	node.addEventListener('pointerdown', onpointerdown, { signal });
	node.addEventListener('pointermove', onpointermove, { signal });
	node.addEventListener('pointerup', cancel, { signal });
	node.addEventListener('pointercancel', cancel, { signal });
	node.addEventListener('contextmenu', oncontextmenu, { signal });
	node.addEventListener('click', onclick, { signal, capture: true });
	node.addEventListener('keydown', onkeydown, { signal });
	return () => {
		cancel();
		listeners.abort();
	};
};
