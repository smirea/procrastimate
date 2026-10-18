import { eq, sql } from 'drizzle-orm';
import { rambleBudget } from '../../shared/db/schema';
import type { Db } from './db/postgres';

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

/** One row per UTC day. The reservation locks the row, so two accounts reserving at once cannot both read the same remainder. */
export function pgRambleBudget(db: Db, limit: number): RambleBudget {
	return {
		async reserve(day, requested) {
			if (!(requested > 0) || !(limit > 0)) return 0;
			return db.transaction(async tx => {
				await tx.insert(rambleBudget).values({ day, seconds: 0 }).onConflictDoNothing();
				const [before] = await tx
					.select({ seconds: rambleBudget.seconds })
					.from(rambleBudget)
					.where(eq(rambleBudget.day, day))
					.for('update');
				const [after] = await tx
					.update(rambleBudget)
					.set({ seconds: sql`LEAST(${rambleBudget.seconds} + ${requested}, ${limit})` })
					.where(eq(rambleBudget.day, day))
					.returning({ seconds: rambleBudget.seconds });
				return Math.min(requested, Math.max(0, (after?.seconds ?? 0) - (before?.seconds ?? 0)));
			});
		},
		async release(day, released) {
			if (!(released > 0)) return;
			await db
				.update(rambleBudget)
				.set({ seconds: sql`GREATEST(0, ${rambleBudget.seconds} - ${released})` })
				.where(eq(rambleBudget.day, day));
		},
	};
}
