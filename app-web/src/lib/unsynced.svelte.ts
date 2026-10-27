import { SvelteSet } from 'svelte/reactivity';
import { localDatabase, queuedTasks } from './database.ts';
import { reportError } from './sentry.ts';
import { UnsyncedQueue } from './unsynced-queue.ts';

/**
 * Online, an upload leaves within the 100 ms throttle and lands a moment later, so a task shows as unsynced only once
 * its write has waited this long. Offline it shows at once.
 */
const UNSYNCED_GRACE = 3000;

/**
 * The tasks with a write in the engine's outbox that the server has not acknowledged, read from the outbox itself,
 * after every local write and every sync. The grace runs on timers rather than clock readings, since the end-to-end
 * specs pin the clock.
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
		const stopChanges = localDatabase.onChange(refresh);
		const stopStatus = localDatabase.onStatus(refresh);
		addEventListener('online', show);
		addEventListener('offline', show);
		refresh();
		return () => {
			this.#run = null;
			stopChanges();
			stopStatus();
			removeEventListener('online', show);
			removeEventListener('offline', show);
			for (const timer of this.#timers) clearTimeout(timer);
			this.#timers.clear();
			this.#queue.clear();
		};
	}

	async #read(run: object) {
		const rows = await queuedTasks();
		if (this.#run === run) this.#queue.read(rows);
	}
}

export const unsynced = new Unsynced();
