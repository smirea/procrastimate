import { MediaQuery } from 'svelte/reactivity';
import type { ListDefaults } from 'shared/screens.ts';
import type { ShareTarget } from 'shared/sharing.ts';
import { toDateKey } from 'shared/task.ts';

/** Matches Tailwind's `md` breakpoint, below which the sidebar becomes a drawer and sheets dock to the bottom. */
export const mobile = new MediaQuery('max-width: 767px');

const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');

/** Svelte transition params that become instant under reduced motion, which CSS cannot reach because Svelte animates from script. */
export const motion = <T extends { duration?: number }>(params: T): T =>
	reducedMotion.current ? { ...params, duration: 0 } : params;

/**
 * Attach to a list item or group that animates out: `{@attach leaving}`. A row moving between lists exists twice while it
 * animates. Svelte makes the leaving copy inert, which not every screen reader honors and Playwright's role queries
 * ignore, so this mirrors `inert` into `aria-hidden`, and Svelte clearing `inert` when the item comes back clears it too.
 */
export function leaving(node: HTMLElement) {
	const observer = new MutationObserver(() => {
		if (node.inert) node.setAttribute('aria-hidden', 'true');
		else node.removeAttribute('aria-hidden');
	});
	observer.observe(node, { attributes: true, attributeFilter: ['inert'] });
	return () => observer.disconnect();
}

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

export type Toast = {
	id: number;
	message: string;
	/** `dismissed` runs once the toast goes, whether or not the action ran. */
	action?: { label: string; run: () => void; dismissed?: () => void };
};

class Toasts {
	items = $state<Toast[]>([]);
	#next = 0;
	#timers = new Map<
		number,
		{ remaining: number; startedAt: number; timeout?: ReturnType<typeof setTimeout>; holds: number }
	>();

	show(message: string, action?: Toast['action'], duration = 5000) {
		const id = ++this.#next;
		this.items.push({ id, message, action });
		this.#timers.set(id, { remaining: duration, startedAt: 0, holds: 0 });
		this.#run(id);
		return id;
	}

	/** Stops a toast's countdown while it is hovered, focused, or touched. Each `hold` pairs with one `release`. */
	hold(id: number) {
		const timer = this.#timers.get(id);
		if (!timer) return;
		if (timer.holds++ === 0) {
			clearTimeout(timer.timeout);
			timer.remaining -= performance.now() - timer.startedAt;
		}
	}

	release(id: number) {
		const timer = this.#timers.get(id);
		if (timer && --timer.holds === 0) this.#run(id);
	}

	dismiss(id: number) {
		clearTimeout(this.#timers.get(id)?.timeout);
		this.#timers.delete(id);
		this.items.find(t => t.id === id)?.action?.dismissed?.();
		this.items = this.items.filter(t => t.id !== id);
	}

	#run(id: number) {
		const timer = this.#timers.get(id)!;
		timer.startedAt = performance.now();
		timer.timeout = setTimeout(() => this.dismiss(id), Math.max(timer.remaining, 0));
	}
}

export const toasts = new Toasts();

export type Arrival = 'forward' | 'back' | 'none';

/** Which floating layer is open. Sheets never stack. */
export type Sheet =
	| { kind: 'none' }
	| { kind: 'quick-add'; defaults: ListDefaults }
	/** The fullscreen voice capture. It opens listening, and saves into the list quick add would have. */
	| { kind: 'ramble'; defaults: ListDefaults }
	| { kind: 'search' }
	| { kind: 'settings' }
	| { kind: 'task'; id: string; arrival: Arrival }
	/** `from` is the task whose details opened it, which closing returns to. */
	| { kind: 'share'; target: ShareTarget; name: string; from: string | null };

class Sheets {
	#current = $state<Sheet>({ kind: 'none' });

	get current() {
		return this.#current;
	}

	/**
	 * A field being edited commits on blur, and iOS Safari never blurs it for a tap on the scrim or a button, so a
	 * sheet change blurs it first: the edit lands before the sheet goes, and an untitled task's new title saves it.
	 */
	set current(next: Sheet) {
		(globalThis.document?.activeElement as HTMLElement | null)?.blur();
		this.#current = next;
	}

	openQuickAdd(defaults: ListDefaults) {
		this.current = { kind: 'quick-add', defaults };
	}

	openRamble(defaults: ListDefaults) {
		this.current = { kind: 'ramble', defaults };
	}

	openSearch() {
		this.current = { kind: 'search' };
	}

	openSettings() {
		this.current = { kind: 'settings' };
	}

	/**
	 * Where each task's details body was scrolled in this sheet. Details remount per task, so going back would
	 * otherwise land at the top of the parent; iOS keeps the place like any navigation pop.
	 */
	readonly scrollTops = new Map<string, number>();

	openTask(id: string, arrival: Arrival = 'none') {
		if (arrival === 'none') this.scrollTops.clear();
		this.current = { kind: 'task', id, arrival };
	}

	openShare(target: ShareTarget, name: string, from: string | null = null) {
		this.current = { kind: 'share', target, name, from };
	}

	close() {
		const current = this.current;
		this.current =
			current.kind === 'share' && current.from ? { kind: 'task', id: current.from, arrival: 'back' } : { kind: 'none' };
	}
}

export const sheets = new Sheets();

/** The task quick add just saved. Its row scrolls into view and flashes, then this clears. */
class Reveal {
	id = $state<string | null>(null);

	show(id: string) {
		this.id = id;
		setTimeout(() => {
			if (this.id === id) this.id = null;
		}, 1500);
	}
}

export const reveal = new Reveal();
