import type { RambleUsage } from '../../../shared/db/schema';
import { reportError } from '../sentry';

export type { RambleUsage };

/**
 * The seconds streamed for one user while the process is up. Seeded once from Turso. Later requests share it, so a
 * socket that records seconds after its upgrade request flushed is still visible to the next request. `persist`
 * writes the current rows; it should snapshot when it runs, not when it is scheduled.
 */
export type RambleLedger = {
	seed(rows: RambleUsage[]): void;
	seconds(day: string): number;
	add(day: string, seconds: number): void;
	clear(): void;
	snapshot(): RambleUsage[];
	settled(): Promise<void>;
};

export function rambleLedger(persist: () => Promise<void>): RambleLedger {
	const usage = new Map<string, number>();
	let seeded = false;
	let pending = Promise.resolve();
	const schedule = () => {
		pending = persist();
		void pending.catch(reportError);
	};
	return {
		seed(rows) {
			if (seeded) return;
			seeded = true;
			for (const row of rows) usage.set(row.day, row.seconds);
		},
		seconds: day => usage.get(day) ?? 0,
		add(day, seconds) {
			if (!(seconds > 0)) return;
			usage.set(day, (usage.get(day) ?? 0) + seconds);
			void schedule();
		},
		clear() {
			usage.clear();
			seeded = true;
			void schedule();
		},
		snapshot: () => [...usage].map(([day, seconds]) => ({ day, seconds })),
		settled: () => pending,
	};
}

/**
 * Schedules each change on `run`, which is the user's queue, and writes whatever the ledger holds when that turn
 * runs. A flush already in progress finishes first, then this write replaces its copy of the seconds.
 */
export function queuedRambleLedger(
	run: <T>(task: () => Promise<T>) => Promise<T>,
	write: (rows: RambleUsage[]) => Promise<void>,
): RambleLedger {
	let ledger!: RambleLedger;
	ledger = rambleLedger(() => run(() => write(ledger.snapshot())));
	return ledger;
}
