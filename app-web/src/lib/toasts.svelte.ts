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
