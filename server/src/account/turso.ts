import { and, asc, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { devices, entities, log, meta, push, rambleUsage } from '../../../shared/db/schema';
import { deviceColumns, entityColumns, logColumns, pushColumns, rambleColumns } from '../db/columns';
import { batch, tursoDatabase, type TursoDatabase, type TursoTarget } from '../db/turso';
import { memoryStore, type AccountTables } from './memory-store';
import type { RambleLedger, RambleUsage } from './ramble-ledger';
import type { AccountStore } from './store';

/**
 * Task data in Turso. The request still runs against the in-memory store, which is loaded at the start and written
 * back at the end, so the sync merge stays synchronous. The Durable Object keeps the sockets and the alarm.
 */

export type AccountSession = { store: AccountStore; flush: () => Promise<void> };

/** Rows per insert, well under SQLite's bound-parameter limit for the widest table. */
const ROWS_PER_INSERT = 100;

function chunks<T>(rows: T[]): T[][] {
	const result: T[][] = [];
	for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
		result.push(rows.slice(start, start + ROWS_PER_INSERT));
	}
	return result;
}

const USER_TABLES = [devices, entities, log, push, rambleUsage, meta];

function writes(db: TursoDatabase, userId: string, tables: AccountTables): BatchItem<'sqlite'>[] {
	const scoped = <T extends object>(rows: T[]) => chunks(rows.map(row => ({ ...row, userId })));
	return [
		...USER_TABLES.map(table => db.delete(table).where(eq(table.userId, userId))),
		db.insert(meta).values({ userId, key: 'epoch', value: String(tables.epoch) }),
		...scoped(tables.devices).map(rows => db.insert(devices).values(rows)),
		...scoped(tables.entities).map(rows => db.insert(entities).values(rows)),
		...scoped(tables.log).map(rows => db.insert(log).values(rows)),
		...scoped(tables.push).map(rows => db.insert(push).values(rows)),
		...scoped(tables.ramble).map(rows => db.insert(rambleUsage).values(rows)),
	];
}

async function readTables(db: TursoDatabase, userId: string): Promise<AccountTables> {
	const [deviceRows, entityRows, logRows, pushRows, rambleRows, epochRows] = await Promise.all([
		db.select(deviceColumns).from(devices).where(eq(devices.userId, userId)),
		db.select(entityColumns).from(entities).where(eq(entities.userId, userId)),
		db.select(logColumns).from(log).where(eq(log.userId, userId)).orderBy(asc(log.seq)),
		db.select(pushColumns).from(push).where(eq(push.userId, userId)),
		db.select(rambleColumns).from(rambleUsage).where(eq(rambleUsage.userId, userId)),
		db
			.select({ value: meta.value })
			.from(meta)
			.where(and(eq(meta.userId, userId), eq(meta.key, 'epoch'))),
	]);
	return {
		devices: deviceRows,
		entities: entityRows,
		log: logRows,
		push: pushRows,
		ramble: rambleRows,
		epoch: Number(epochRows[0]?.value ?? 0),
	};
}

/**
 * Ramble seconds stay on `ledger` when one is passed, including the copy `tables()` flushes. The per-request
 * memory would otherwise forget seconds recorded after this request returned.
 */
function withRambleLedger(
	store: AccountStore & { tables(): AccountTables },
	ledger: RambleLedger,
): AccountStore & { tables(): AccountTables } {
	return {
		...store,
		rambleSeconds: day => ledger.seconds(day),
		addRambleSeconds: (day, seconds) => {
			ledger.add(day, seconds);
		},
		clearAccount: () => {
			store.clearAccount();
			ledger.clear();
		},
		tables: () => ({ ...store.tables(), ramble: ledger.snapshot() }),
	};
}

/** Replaces one user's Ramble rows. The global budget table is left alone. */
export async function writeRambleUsage(db: TursoDatabase, userId: string, rows: RambleUsage[]) {
	await batch(db, [
		db.delete(rambleUsage).where(eq(rambleUsage.userId, userId)),
		...chunks(rows.map(row => ({ ...row, userId }))).map(chunk => db.insert(rambleUsage).values(chunk)),
	]);
}

export async function writeUserRamble(target: TursoTarget, userId: string, rows: RambleUsage[]) {
	await writeRambleUsage(await tursoDatabase(target), userId, rows);
}

/** Loads one user's rows into memory. `flush` replaces that user's rows and leaves everyone else. */
export async function accountSession(
	db: TursoDatabase,
	userId: string,
	ledger?: RambleLedger,
): Promise<AccountSession> {
	const loaded = await readTables(db, userId);
	ledger?.seed(loaded.ramble);
	const store = ledger ? withRambleLedger(memoryStore(loaded), ledger) : memoryStore(loaded);
	return {
		store,
		flush: () => batch(db, writes(db, userId, store.tables())),
	};
}

export async function tursoSession(target: TursoTarget, userId: string, ledger?: RambleLedger) {
	return accountSession(await tursoDatabase(target), userId, ledger);
}
