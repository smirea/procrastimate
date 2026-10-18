import { tick } from 'svelte';

/** A mouse lifts a held row once it moves this far, so a click still activates it. */
const MOUSE_SLOP = 4;
/** A finger lifts a held row after holding it this long, and moving further first scrolls instead. */
const LONG_PRESS_MS = 350;
const TOUCH_SLOP = 8;
/** Within this distance of the scroller's edge, a dragged row scrolls the list, faster the closer it gets. */
const EDGE = 56;
const MAX_SCROLL_PER_FRAME = 14;

type Press = {
	id: string;
	index: number;
	pointerId: number;
	startX: number;
	startY: number;
	touch: boolean;
	timer?: number;
};
type Drag = {
	id: string;
	from: number;
	to: number;
	/** Row midpoints and the pointer's y, in viewport coordinates at lift time. */
	mids: number[];
	/** How far the rows it passes shift: its own height plus the gap between rows. */
	step: number;
	/** The lifted row's center stays between the first row's top and the last row's bottom, so it can take either end. */
	minDy: number;
	maxDy: number;
	/** How far the lifted row was drawn from its layout place, such as mid-flip, so it starts under the pointer. */
	drawn: number;
	startY: number;
	clientY: number;
	scroller: Element;
	scrollStart: number;
	dy: number;
};

type Options = {
	/** The data attribute every row carries with its id, such as `data-project-id`. */
	key: string;
	count: () => number;
	move: (id: string, to: number) => void;
	/**
	 * `handle` lifts the row as soon as its drag handle is pressed. `hold` lifts a row that is
	 * itself a link or button: a mouse after a few pixels, a finger after a long press.
	 */
	lift: 'handle' | 'hold';
};

/** Drag-to-reorder for a vertical list: lift, shift the other rows, auto-scroll at the edges, and settle on drop. */
export class Reorder {
	drag = $state<Drag | null>(null);
	settling = $state(false);
	#press: Press | null = null;
	#list: HTMLElement | null = null;
	#frame = 0;
	#options: Options;

	constructor(options: Options) {
		this.#options = options;
	}

	get busy() {
		return !!this.#press || !!this.drag;
	}

	/** Attach to the list element: `{@attach reorder.list}`. */
	list = (element: HTMLElement) => {
		this.#list = element;
		// Svelte adds touch listeners as passive, and only a non-passive one can stop the page scrolling under a drag.
		const hold = (event: TouchEvent) => {
			if (this.drag) event.preventDefault();
		};
		element.addEventListener('touchmove', hold, { passive: false });
		return () => {
			element.removeEventListener('touchmove', hold);
			this.#release();
			this.#list = null;
		};
	};

	start(event: PointerEvent, id: string, index: number) {
		if (event.button !== 0 || this.#options.count() < 2 || this.#press || this.settling) return;
		const touch = event.pointerType !== 'mouse';
		this.#press = { id, index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, touch };
		window.addEventListener('pointermove', this.#onmove);
		window.addEventListener('pointerup', this.#onup);
		window.addEventListener('pointercancel', this.#oncancel);
		if (this.#options.lift === 'handle') {
			event.preventDefault();
			this.#lift();
		} else if (touch) {
			this.#press.timer = window.setTimeout(() => this.#lift(), LONG_PRESS_MS);
		}
	}

	offset(index: number, id: string) {
		const drag = this.drag;
		if (!drag) return 0;
		if (id === drag.id) return drag.dy;
		if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.step;
		if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.step;
		return 0;
	}

	#rows() {
		return [...this.#list!.querySelectorAll<HTMLElement>(`[${this.#options.key}]`)];
	}

	#lift() {
		const press = this.#press;
		if (!press || !this.#list) return;
		const rows = this.#rows();
		const rects = rows.map(row => layoutRect(row, this.#list!));
		const own = rects[press.index]!;
		const drawn = rows[press.index]!.getBoundingClientRect().top - own.top;
		const mid = own.top + own.height / 2;
		const gap = rects.length > 1 ? rects[1]!.top - rects[0]!.bottom : 0;
		const scroller = scrollerOf(this.#list);
		this.drag = {
			id: press.id,
			from: press.index,
			to: press.index,
			mids: rects.map(r => r.top + r.height / 2),
			step: own.height + gap,
			minDy: rects[0]!.top - mid,
			maxDy: rects.at(-1)!.bottom - mid,
			drawn,
			startY: press.startY,
			clientY: press.startY,
			scroller,
			scrollStart: scroller.scrollTop,
			dy: drawn,
		};
		if (press.touch && this.#options.lift === 'hold') navigator.vibrate?.(8);
		this.#frame = requestAnimationFrame(this.#autoscroll);
	}

	#onmove = (event: PointerEvent) => {
		const press = this.#press;
		if (event.pointerId !== press?.pointerId) return;
		if (!this.drag) {
			const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
			if (press.touch) {
				if (distance > TOUCH_SLOP) this.#release();
				return;
			}
			if (Math.abs(event.clientY - press.startY) < MOUSE_SLOP) return;
			this.#lift();
		}
		this.drag!.clientY = event.clientY;
		this.#follow();
	};

	/** Places the lifted row under the pointer, counting how far the list scrolled since the lift. */
	#follow() {
		const drag = this.drag!;
		const scrolled = drag.scroller.scrollTop - drag.scrollStart;
		drag.dy = Math.max(drag.minDy, Math.min(drag.drawn + drag.clientY - drag.startY + scrolled, drag.maxDy));
		const center = drag.mids[drag.from]! + drag.dy;
		drag.to = drag.mids.filter((mid, i) => i !== drag.from && mid < center).length;
	}

	#autoscroll = () => {
		const drag = this.drag;
		if (!drag) return;
		const { top, bottom } = visibleBounds(drag.scroller);
		const speed = (depth: number) => Math.ceil(MAX_SCROLL_PER_FRAME * Math.min(1, depth / EDGE) ** 2);
		const delta =
			drag.clientY < top + EDGE
				? -speed(top + EDGE - drag.clientY)
				: drag.clientY > bottom - EDGE
					? speed(drag.clientY - (bottom - EDGE))
					: 0;
		if (delta) {
			const before = drag.scroller.scrollTop;
			drag.scroller.scrollTop = before + delta;
			if (drag.scroller.scrollTop !== before) this.#follow();
		}
		this.#frame = requestAnimationFrame(this.#autoscroll);
	};

	#onup = (event: PointerEvent) => {
		if (event.pointerId === this.#press?.pointerId) void this.#drop(true);
	};

	#oncancel = (event: PointerEvent) => {
		if (event.pointerId === this.#press?.pointerId) void this.#drop(false);
	};

	#release() {
		window.clearTimeout(this.#press?.timer);
		cancelAnimationFrame(this.#frame);
		this.#press = null;
		window.removeEventListener('pointermove', this.#onmove);
		window.removeEventListener('pointerup', this.#onup);
		window.removeEventListener('pointercancel', this.#oncancel);
	}

	async #drop(commit: boolean) {
		this.#release();
		const ended = this.drag;
		if (!ended || !this.#list) return;
		swallowClick();
		const list = this.#list;
		const row = () => list.querySelector(`[${this.#options.key}="${ended.id}"]`);
		const lifted = row()?.getBoundingClientRect().top ?? 0;
		this.settling = true;
		this.drag = null;
		// A sync that added or removed a row mid-drag moved every index; the drop then names the wrong place.
		const same = this.#rows().length === ended.mids.length;
		if (commit && same && ended.to !== ended.from) this.#options.move(ended.id, ended.to);
		await tick();
		const landed = row();
		const residual = lifted - (landed?.getBoundingClientRect().top ?? lifted);
		landed?.animate([{ transform: `translateY(${residual}px)` }, { transform: 'none' }], {
			duration: 200,
			easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
		});
		this.settling = false;
	}
}

/**
 * A row's place in the layout, in viewport coordinates. A row can be mid-flip or still holding a drag offset, and its
 * transformed rect would put the drop bounds and midpoints where the row is drawn instead of where it sits.
 */
function layoutRect(row: HTMLElement, list: HTMLElement) {
	if (row.offsetParent !== list) throw new Error('A reorderable list must be the positioned parent of its rows');
	const top = list.getBoundingClientRect().top + list.clientTop + row.offsetTop;
	return { top, bottom: top + row.offsetHeight, height: row.offsetHeight };
}

function scrollerOf(element: HTMLElement): Element {
	for (let node = element.parentElement; node; node = node.parentElement) {
		if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
	}
	return document.scrollingElement ?? document.documentElement;
}

function visibleBounds(scroller: Element) {
	if (scroller === document.scrollingElement) return { top: 0, bottom: window.innerHeight };
	const rect = scroller.getBoundingClientRect();
	return { top: Math.max(rect.top, 0), bottom: Math.min(rect.bottom, window.innerHeight) };
}

/** The pointer that ends a drag must not also activate the row it lifted. */
function swallowClick() {
	const swallow = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	window.addEventListener('click', swallow, { capture: true, once: true });
	setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
}
