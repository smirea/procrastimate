import { eq, sql } from 'drizzle-orm';
import { rambleBudget } from '../../../shared/db/schema';
import { tursoDatabase, type TursoDatabase, type TursoTarget } from '../db/turso';
import { serialQueue } from './serial';

/**
 * Audio seconds the whole deployment may stream in one UTC day. Two hours is enough for one account to use its
 * own 60 minutes on both sides of UTC midnight, and it stops any further accounts from stacking on top.
 */
export const RAMBLE_GLOBAL_DAILY_SECONDS = 2 * 60 * 60;

/**
 * The shared ElevenLabs budget. `reserve` grants up to `seconds` without passing the daily limit.
 * `release` gives unused seconds back. Both are safe to call concurrently.
 */
export type RambleBudget = {
	reserve(day: string, seconds: number): Promise<number>;
	release(day: string, seconds: number): Promise<void>;
};

/** In-process budget for tests and for a dev server that is not on Turso. */
export function memoryRambleBudget(limit: number): RambleBudget {
	const used = new Map<string, number>();
	const run = serialQueue();
	return {
		reserve: (day, seconds) =>
			run(async () => {
				const current = used.get(day) ?? 0;
				const granted = Math.max(0, Math.min(seconds, limit - current));
				if (granted > 0) used.set(day, current + granted);
				return granted;
			}),
		release: (day, seconds) =>
			run(async () => {
				if (!(seconds > 0)) return;
				used.set(day, Math.max(0, (used.get(day) ?? 0) - seconds));
			}),
	};
}

/**
 * One Turso row per UTC day. The batch is one transaction that writes first, so two accounts reserving at once
 * cannot both read the same remainder.
 */
export function tursoRambleBudget(db: TursoDatabase, limit: number): RambleBudget {
	const seconds = (day: string) =>
		db.select({ seconds: rambleBudget.seconds }).from(rambleBudget).where(eq(rambleBudget.day, day));
	return {
		async reserve(day, requested) {
			if (!(requested > 0) || !(limit > 0)) return 0;
			const [, before, , after] = await db.batch([
				db.insert(rambleBudget).values({ day, seconds: 0 }).onConflictDoNothing(),
				seconds(day),
				db
					.update(rambleBudget)
					.set({ seconds: sql`MIN(${rambleBudget.seconds} + ${requested}, ${limit})` })
					.where(eq(rambleBudget.day, day)),
				seconds(day),
			]);
			return Math.min(requested, Math.max(0, (after[0]?.seconds ?? 0) - (before[0]?.seconds ?? 0)));
		},
		async release(day, released) {
			if (!(released > 0)) return;
			await db
				.update(rambleBudget)
				.set({ seconds: sql`MAX(0, ${rambleBudget.seconds} - ${released})` })
				.where(eq(rambleBudget.day, day));
		},
	};
}

/** Opens lazily, so a budget made at startup does not reach Turso until the first reservation. */
export function openRambleBudget(target: TursoTarget, limit = RAMBLE_GLOBAL_DAILY_SECONDS): RambleBudget {
	const budget = () => tursoDatabase(target).then(db => tursoRambleBudget(db, limit));
	return {
		reserve: async (day, seconds) => (await budget()).reserve(day, seconds),
		release: async (day, seconds) => (await budget()).release(day, seconds),
	};
}
