import { toDateKey } from 'shared/task.ts';

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

export type QuickAddDefaults = { projectId: string | null; today: boolean };

/** Which floating layer is open. Quick add and task details never stack. */
export type Sheet = { kind: 'none' } | { kind: 'quick-add'; defaults: QuickAddDefaults } | { kind: 'task'; id: string };

class Sheets {
	current = $state<Sheet>({ kind: 'none' });

	openQuickAdd(defaults: QuickAddDefaults) {
		this.current = { kind: 'quick-add', defaults };
	}

	openTask(id: string) {
		this.current = { kind: 'task', id };
	}

	close() {
		this.current = { kind: 'none' };
	}
}

export const sheets = new Sheets();
