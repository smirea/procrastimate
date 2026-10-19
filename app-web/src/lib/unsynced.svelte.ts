import { SvelteSet } from 'svelte/reactivity';
import { powerSync } from './database.ts';
import { reportError } from './sentry.ts';

/**
 * Online, an upload leaves within the 100 ms throttle and lands a moment later, so a task shows as unsynced only once
 * its write has waited this long. Offline it shows at once.
 */
const UNSYNCED_GRACE = 3000;

/** Each queued task with its oldest queued write, which is what has been waiting. */
const QUEUED_TASKS = `SELECT json_extract(data, '$.id') AS id, MIN(id) AS row FROM ps_crud WHERE json_extract(data, '$.type') = 'tasks' GROUP BY 1`;

type Queued = { row: number; ripe: boolean };

/**
 * The tasks with a write in PowerSync's upload queue that has not reached the server, read from the queue itself. The
 * grace runs from a task's oldest queued write, so typing that uploads keystroke by keystroke, each one queued before
 * the last lands, never shows it. It runs on timers rather than clock readings, since the end-to-end specs pin the
 * clock.
 */
class Unsynced {
	#shown = new SvelteSet<string>();
	#queued = new Map<string, Queued>();
	#run: object | null = null;
	#timers = new Set<ReturnType<typeof setTimeout>>();

	has(taskId: string): boolean {
		return this.#shown.has(taskId);
	}

	start(): () => void {
		const run = {};
		this.#run = run;
		const refresh = () => void this.#read(run).catch(reportError);
		const show = () => this.#show();
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
			this.#queued.clear();
			this.#shown.clear();
		};
	}

	async #read(run: object) {
		const rows = await powerSync.getAll<{ id: string; row: number }>(QUEUED_TASKS);
		if (this.#run !== run) return;
		const queued = new Map<string, Queued>();
		const waiting: Queued[] = [];
		for (const { id, row } of rows) {
			const known = this.#queued.get(id);
			if (known?.row === row) {
				queued.set(id, known);
				continue;
			}
			const entry = { row, ripe: false };
			queued.set(id, entry);
			waiting.push(entry);
			this.#shown.delete(id);
		}
		this.#queued = queued;
		if (waiting.length) {
			const timer = setTimeout(() => {
				this.#timers.delete(timer);
				for (const entry of waiting) entry.ripe = true;
				this.#show();
			}, UNSYNCED_GRACE);
			this.#timers.add(timer);
		}
		this.#show();
	}

	/** A shown task stays until its oldest write leaves the queue, so coming back online never hides it for a moment. */
	#show() {
		for (const id of this.#shown) if (!this.#queued.has(id)) this.#shown.delete(id);
		for (const [id, { ripe }] of this.#queued) if (ripe || !navigator.onLine) this.#shown.add(id);
	}
}

export const unsynced = new Unsynced();
