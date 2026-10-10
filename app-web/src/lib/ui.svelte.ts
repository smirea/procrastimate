import { MediaQuery } from 'svelte/reactivity';
import { toDateKey } from 'shared/task.ts';

/** Matches Tailwind's `md` breakpoint, below which the sidebar becomes a drawer and sheets dock to the bottom. */
export const mobile = new MediaQuery('max-width: 767px');

/**
 * Publishes the on-screen keyboard's height as `--keyboard-inset` so bottom sheets sit above it.
 * iOS Safari overlays the keyboard instead of resizing the layout viewport, so only the visual viewport shrinks.
 */
export function trackKeyboardInset() {
	const viewport = window.visualViewport;
	if (!viewport) return;
	const update = () => {
		const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
		document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
		document.documentElement.toggleAttribute('data-keyboard', inset > 0);
	};
	update();
	viewport.addEventListener('resize', update);
	viewport.addEventListener('scroll', update);
	return () => {
		viewport.removeEventListener('resize', update);
		viewport.removeEventListener('scroll', update);
	};
}

/** Minute-resolution clock, so Today rolls over at midnight and reminders fire while the app is open. */
class Clock {
	now = $state(Date.now());
	today = $derived(toDateKey(new Date(this.now)));

	start() {
		const id = setInterval(() => (this.now = Date.now()), 15_000);
		return () => clearInterval(id);
	}
}

export const clock = new Clock();

export type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

class Toasts {
	items = $state<Toast[]>([]);
	#next = 0;

	show(message: string, action?: Toast['action'], duration = 5000) {
		const id = ++this.#next;
		this.items.push({ id, message, action });
		setTimeout(() => this.dismiss(id), duration);
	}

	dismiss(id: number) {
		this.items = this.items.filter(t => t.id !== id);
	}
}

export const toasts = new Toasts();

export type QuickAddDefaults = { projectId: string | null; labelId: string | null; today: boolean };

/** Which floating layer is open. Quick add, search, and task details never stack. */
export type Sheet =
	| { kind: 'none' }
	| { kind: 'quick-add'; defaults: QuickAddDefaults }
	| { kind: 'search' }
	| { kind: 'task'; id: string };

class Sheets {
	current = $state<Sheet>({ kind: 'none' });

	openQuickAdd(defaults: QuickAddDefaults) {
		this.current = { kind: 'quick-add', defaults };
	}

	openSearch() {
		this.current = { kind: 'search' };
	}

	openTask(id: string) {
		this.current = { kind: 'task', id };
	}

	close() {
		this.current = { kind: 'none' };
	}
}

export const sheets = new Sheets();
