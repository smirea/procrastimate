import { createClient, type Client, type InStatement } from '@libsql/client/web';
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

const BUDGET_TABLE = `CREATE TABLE IF NOT EXISTS ramble_budget (
	day TEXT PRIMARY KEY, seconds REAL NOT NULL)`;

const num = (value: unknown) => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0));

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
 * One Turso row per UTC day. The batch is a write transaction, so two accounts reserving at once cannot both
 * read the same remainder.
 */
export function tursoRambleBudget(client: Client, limit: number): RambleBudget {
	return {
		async reserve(day, seconds) {
			if (!(seconds > 0) || !(limit > 0)) return 0;
			const statements: InStatement[] = [
				{ sql: BUDGET_TABLE, args: [] },
				{ sql: 'INSERT INTO ramble_budget (day, seconds) VALUES (?, 0) ON CONFLICT(day) DO NOTHING', args: [day] },
				{ sql: 'SELECT seconds FROM ramble_budget WHERE day = ?', args: [day] },
				{ sql: 'UPDATE ramble_budget SET seconds = MIN(seconds + ?, ?) WHERE day = ?', args: [seconds, limit, day] },
				{ sql: 'SELECT seconds FROM ramble_budget WHERE day = ?', args: [day] },
			];
			const results = await client.batch(statements, 'write');
			const before = num(results[2]?.rows[0]?.seconds);
			const after = num(results[4]?.rows[0]?.seconds);
			return Math.min(seconds, Math.max(0, after - before));
		},
		async release(day, seconds) {
			if (!(seconds > 0)) return;
			await client.execute({
				sql: 'UPDATE ramble_budget SET seconds = MAX(0, seconds - ?) WHERE day = ?',
				args: [seconds, day],
			});
		},
	};
}

export function openRambleBudget(url: string, authToken: string, limit = RAMBLE_GLOBAL_DAILY_SECONDS): RambleBudget {
	return tursoRambleBudget(createClient({ url, authToken }), limit);
}
