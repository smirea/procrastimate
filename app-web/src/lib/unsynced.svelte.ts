import { SvelteSet } from 'svelte/reactivity';
import { powerSync } from './database.ts';
import { reportError } from './sentry.ts';
import { UnsyncedQueue } from './unsynced-queue.ts';

/**
 * Online, an upload leaves within the 100 ms throttle and lands a moment later, so a task shows as unsynced only once
 * its write has waited this long. Offline it shows at once.
 */
const UNSYNCED_GRACE = 3000;

/** Each queued task with its oldest queued write, which is what has been waiting. */
const QUEUED_TASKS = `SELECT json_extract(data, '$.id') AS id, MIN(id) AS row FROM ps_crud WHERE json_extract(data, '$.type') = 'tasks' GROUP BY 1`;

/**
 * The tasks with a write in PowerSync's upload queue that has not reached the server, read from the queue itself. The
 * grace runs on timers rather than clock readings, since the end-to-end specs pin the clock.
 */
class Unsynced {
	#run: object | null = null;
	#timers = new Set<ReturnType<typeof setTimeout>>();
	#queue = new UnsyncedQueue(
		new SvelteSet<string>(),
		ripen => {
			const timer = setTimeout(() => {
				this.#timers.delete(timer);
				ripen();
			}, UNSYNCED_GRACE);
			this.#timers.add(timer);
		},
		() => navigator.onLine,
	);

	has(taskId: string): boolean {
		return this.#queue.shown.has(taskId);
	}

	start(): () => void {
		const run = {};
		this.#run = run;
		const refresh = () => void this.#read(run).catch(reportError);
		const show = () => this.#queue.show();
		const dispose = powerSync.onChange({ onChange: refresh }, { tables: ['ps_crud'], throttleMs: 50 });
		addEventListener('online', show);
		addEventListener('offline', show);
		refresh();
		return () => {
			this.#run = null;
			dispose();
			removeEventListener('online', show);
			removeEventListener('offline', show);
			for (const timer of this.#timers) clearTimeout(timer);
			this.#timers.clear();
			this.#queue.clear();
		};
	}

	async #read(run: object) {
		const rows = await powerSync.getAll<{ id: string; row: number }>(QUEUED_TASKS);
		if (this.#run === run) this.#queue.read(rows);
	}
}

export const unsynced = new Unsynced();
