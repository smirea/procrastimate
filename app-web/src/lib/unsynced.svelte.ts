import { SvelteSet } from 'svelte/reactivity';
import { powerSync } from './database.ts';
import { reportError } from './sentry.ts';

/**
 * Online, an upload leaves within the 100 ms throttle and lands a moment later, so a task shows as unsynced only once
 * its write has waited this long. Offline it shows at once.
 */
const UNSYNCED_GRACE = 3000;

const QUEUED_TASKS = `SELECT DISTINCT json_extract(data, '$.id') AS id FROM ps_crud WHERE json_extract(data, '$.type') = 'tasks'`;

/**
 * The tasks with a write in PowerSync's upload queue that has not reached the server, read from the queue itself. The
 * grace runs on timers rather than clock readings, since the end-to-end specs pin the clock.
 */
class Unsynced {
	#shown = new SvelteSet<string>();
	/** Each queued task, with the timer of its grace while it runs, from the first write seen queued. */
	#queued = new Map<string, ReturnType<typeof setTimeout> | null>();
	#running = false;

	has(taskId: string): boolean {
		return this.#shown.has(taskId);
	}

	start(): () => void {
		const refresh = () => void this.#read().catch(reportError);
		const show = () => this.#show();
		const dispose = powerSync.onChange({ onChange: refresh }, { tables: ['ps_crud'], throttleMs: 50 });
		addEventListener('online', show);
		addEventListener('offline', show);
		this.#running = true;
		refresh();
		return () => {
			this.#running = false;
			dispose();
			removeEventListener('online', show);
			removeEventListener('offline', show);
			for (const timer of this.#queued.values()) clearTimeout(timer ?? undefined);
			this.#queued.clear();
			this.#shown.clear();
		};
	}

	async #read() {
		const queued = new Set((await powerSync.getAll<{ id: string }>(QUEUED_TASKS)).map(row => row.id));
		if (!this.#running) return;
		for (const [id, timer] of this.#queued) {
			if (queued.has(id)) continue;
			clearTimeout(timer ?? undefined);
			this.#queued.delete(id);
		}
		for (const id of queued) {
			if (this.#queued.has(id)) continue;
			const timer = setTimeout(() => {
				this.#queued.set(id, null);
				this.#show();
			}, UNSYNCED_GRACE);
			this.#queued.set(id, timer);
		}
		this.#show();
	}

	/** A task once shown stays until its writes leave the queue, so coming back online never hides it for a moment. */
	#show() {
		for (const id of this.#shown) if (!this.#queued.has(id)) this.#shown.delete(id);
		for (const [id, timer] of this.#queued) if (timer === null || !navigator.onLine) this.#shown.add(id);
	}
}

export const unsynced = new Unsynced();
