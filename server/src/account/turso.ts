import { and, asc, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
	apiTokens,
	devices,
	log,
	memberships,
	meta,
	people,
	push,
	rambleUsage,
	shares,
	taskClients,
} from '../../../shared/db/schema';
import { KINDS } from '../../../shared/sync/kinds';
import { ENTITY_TABLES, entityRow, rowEntity } from '../db/entities';
import {
	apiTokenColumns,
	deviceColumns,
	logColumns,
	membershipColumns,
	personColumns,
	pushColumns,
	rambleColumns,
	shareColumns,
	taskClientsColumns,
} from '../db/columns';
import { batch, tursoDatabase, type TursoDatabase, type TursoTarget } from '../db/turso';
import { memoryStore, type AccountTables } from './memory-store';
import type { RambleLedger, RambleUsage } from './ramble-ledger';
import { span } from '../sentry';
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

const USER_TABLES = [
	...Object.values(ENTITY_TABLES),
	devices,
	log,
	taskClients,
	push,
	rambleUsage,
	meta,
	shares,
	memberships,
	people,
	apiTokens,
];

function writes(db: TursoDatabase, userId: string, tables: AccountTables): BatchItem<'sqlite'>[] {
	const scoped = <T extends object>(rows: T[]) => chunks(rows.map(row => ({ ...row, userId })));
	return [
		...USER_TABLES.map(table => db.delete(table).where(eq(table.userId, userId))),
		db.insert(meta).values({ userId, key: 'epoch', value: String(tables.epoch) }),
		...scoped(tables.devices).map(rows => db.insert(devices).values(rows)),
		...KINDS.flatMap(kind => {
			const rows = tables.entities.filter(entity => entity.kind === kind).map(entity => entityRow(userId, entity));
			return chunks(rows).map(chunk => db.insert(ENTITY_TABLES[kind]).values(chunk));
		}),
		...scoped(tables.log).map(rows => db.insert(log).values(rows)),
		...scoped(tables.taskClients).map(rows => db.insert(taskClients).values(rows)),
		...scoped(tables.push).map(rows => db.insert(push).values(rows)),
		...scoped(tables.ramble).map(rows => db.insert(rambleUsage).values(rows)),
		...scoped(tables.shares).map(rows => db.insert(shares).values(rows)),
		...scoped(tables.memberships).map(rows => db.insert(memberships).values(rows)),
		...scoped(tables.people).map(rows => db.insert(people).values(rows)),
		...scoped(tables.apiTokens).map(rows => db.insert(apiTokens).values(rows)),
	];
}

async function readTables(db: TursoDatabase, userId: string): Promise<AccountTables> {
	const loadEntities = Promise.all(
		KINDS.map(async kind => {
			const table = ENTITY_TABLES[kind];
			const rows = await db.select().from(table).where(eq(table.userId, userId));
			return rows.map(row => rowEntity(kind, row));
		}),
	);
	const [
		entityRows,
		deviceRows,
		logRows,
		taskClientRows,
		pushRows,
		rambleRows,
		epochRows,
		shareRows,
		membershipRows,
		personRows,
		apiTokenRows,
	] = await Promise.all([
		loadEntities,
		db.select(deviceColumns).from(devices).where(eq(devices.userId, userId)),
		db.select(logColumns).from(log).where(eq(log.userId, userId)).orderBy(asc(log.seq)),
		db.select(taskClientsColumns).from(taskClients).where(eq(taskClients.userId, userId)),
		db.select(pushColumns).from(push).where(eq(push.userId, userId)),
		db.select(rambleColumns).from(rambleUsage).where(eq(rambleUsage.userId, userId)),
		db
			.select({ value: meta.value })
			.from(meta)
			.where(and(eq(meta.userId, userId), eq(meta.key, 'epoch'))),
		db.select(shareColumns).from(shares).where(eq(shares.userId, userId)),
		db.select(membershipColumns).from(memberships).where(eq(memberships.userId, userId)),
		db.select(personColumns).from(people).where(eq(people.userId, userId)),
		db.select(apiTokenColumns).from(apiTokens).where(eq(apiTokens.userId, userId)),
	]);
	return {
		devices: deviceRows,
		entities: entityRows.flat(),
		log: logRows,
		taskClients: taskClientRows,
		push: pushRows,
		ramble: rambleRows,
		shares: shareRows,
		memberships: membershipRows,
		people: personRows,
		apiTokens: apiTokenRows,
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
	const loaded = await span('load account', 'db', () => readTables(db, userId));
	ledger?.seed(loaded.ramble);
	const store = ledger ? withRambleLedger(memoryStore(loaded), ledger) : memoryStore(loaded);
	return {
		store,
		flush: () => span('flush account', 'db', () => batch(db, writes(db, userId, store.tables()))),
	};
}

export async function tursoSession(target: TursoTarget, userId: string, ledger?: RambleLedger) {
	return accountSession(await tursoDatabase(target), userId, ledger);
}
