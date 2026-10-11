import { createClient, type Client, type InStatement } from '@libsql/client/web';
import { memoryStore, type AccountTables } from './memory-store';
import type { AccountStore, Device, Entity, LogEntry, PushTarget } from './store';

/**
 * Task data in Turso. The request still runs against the in-memory store, which is loaded at the start and written
 * back at the end, so the sync merge stays synchronous. The Durable Object keeps the sockets and the alarm.
 */

export type AccountSession = { store: AccountStore; flush: () => Promise<void> };

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS entities (
		user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, clocks TEXT NOT NULL,
		PRIMARY KEY (user_id, kind, id))`,
	`CREATE TABLE IF NOT EXISTS log (
		user_id TEXT NOT NULL, seq INTEGER NOT NULL, op_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
		fields TEXT NOT NULL, PRIMARY KEY (user_id, seq))`,
	`CREATE INDEX IF NOT EXISTS log_op_id ON log (user_id, op_id)`,
	`CREATE TABLE IF NOT EXISTS devices (
		user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
		created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER,
		PRIMARY KEY (user_id, id))`,
	`CREATE TABLE IF NOT EXISTS meta (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))`,
	`CREATE TABLE IF NOT EXISTS push (
		user_id TEXT NOT NULL, device_id TEXT NOT NULL, subscription TEXT NOT NULL, notifications TEXT NOT NULL,
		delivered_through INTEGER NOT NULL, PRIMARY KEY (user_id, device_id))`,
	`CREATE TABLE IF NOT EXISTS ramble_usage (
		user_id TEXT NOT NULL, day TEXT NOT NULL, seconds REAL NOT NULL, PRIMARY KEY (user_id, day))`,
].join(';\n');

const DROP_UNSCOPED = [
	'DROP TABLE IF EXISTS entities',
	'DROP TABLE IF EXISTS log',
	'DROP TABLE IF EXISTS devices',
	'DROP TABLE IF EXISTS meta',
	'DROP TABLE IF EXISTS push',
	'DROP TABLE IF EXISTS ramble_usage',
].join(';\n');

type Row = Record<string, unknown>;

const text = (value: unknown) => (value == null ? '' : String(value));
const num = (value: unknown) => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0));
const nullableNum = (value: unknown) => (value == null ? null : num(value));

function statements(userId: string, tables: AccountTables): InStatement[] {
	const writes: InStatement[] = [
		{ sql: 'DELETE FROM devices WHERE user_id = ?', args: [userId] },
		{ sql: 'DELETE FROM entities WHERE user_id = ?', args: [userId] },
		{ sql: 'DELETE FROM log WHERE user_id = ?', args: [userId] },
		{ sql: 'DELETE FROM push WHERE user_id = ?', args: [userId] },
		{ sql: 'DELETE FROM ramble_usage WHERE user_id = ?', args: [userId] },
		{ sql: 'DELETE FROM meta WHERE user_id = ?', args: [userId] },
		{ sql: 'INSERT INTO meta (user_id, key, value) VALUES (?, ?, ?)', args: [userId, 'epoch', String(tables.epoch)] },
	];
	for (const device of tables.devices) {
		writes.push({
			sql: 'INSERT INTO devices (user_id, id, name, token_hash, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			args: [userId, device.id, device.name, device.tokenHash, device.createdAt, device.lastSeenAt, device.revokedAt],
		});
	}
	for (const entity of tables.entities) {
		writes.push({
			sql: 'INSERT INTO entities (user_id, kind, id, data, clocks) VALUES (?, ?, ?, ?, ?)',
			args: [userId, entity.kind, entity.id, JSON.stringify(entity.data), JSON.stringify(entity.clocks)],
		});
	}
	for (const entry of tables.log) {
		writes.push({
			sql: 'INSERT INTO log (user_id, seq, op_id, kind, id, fields) VALUES (?, ?, ?, ?, ?, ?)',
			args: [userId, entry.seq, entry.opId, entry.kind, entry.id, JSON.stringify(entry.fields)],
		});
	}
	for (const target of tables.push) {
		writes.push({
			sql: 'INSERT INTO push (user_id, device_id, subscription, notifications, delivered_through) VALUES (?, ?, ?, ?, ?)',
			args: [
				userId,
				target.deviceId,
				JSON.stringify(target.subscription),
				JSON.stringify(target.notifications),
				target.deliveredThrough,
			],
		});
	}
	for (const row of tables.ramble) {
		writes.push({
			sql: 'INSERT INTO ramble_usage (user_id, day, seconds) VALUES (?, ?, ?)',
			args: [userId, row.day, row.seconds],
		});
	}
	return writes;
}

async function select(client: Client, statement: InStatement): Promise<Row[]> {
	const result = await client.execute(statement);
	return result.rows as unknown as Row[];
}

/**
 * Tables from before accounts were per user have no `user_id`. They are dropped. There is no backwards-compatible
 * read: one user's flush used to delete every row.
 */
async function ensureSchema(client: Client) {
	const existing = await select(client, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entities'");
	if (existing.length) {
		const scoped = await select(client, "SELECT name FROM pragma_table_info('entities') WHERE name = 'user_id'");
		if (!scoped.length) await client.executeMultiple(DROP_UNSCOPED);
	}
	await client.executeMultiple(SCHEMA);
}

async function readTables(client: Client, userId: string): Promise<AccountTables> {
	const where = { sql: '', args: [userId] };
	const [devices, entities, log, push, ramble, meta] = await Promise.all([
		select(client, { sql: 'SELECT * FROM devices WHERE user_id = ?', args: where.args }),
		select(client, { sql: 'SELECT * FROM entities WHERE user_id = ?', args: where.args }),
		select(client, { sql: 'SELECT * FROM log WHERE user_id = ? ORDER BY seq', args: where.args }),
		select(client, { sql: 'SELECT * FROM push WHERE user_id = ?', args: where.args }),
		select(client, { sql: 'SELECT * FROM ramble_usage WHERE user_id = ?', args: where.args }),
		select(client, { sql: "SELECT value FROM meta WHERE user_id = ? AND key = 'epoch'", args: where.args }),
	]);
	return {
		devices: devices.map((row): Device => ({
			id: text(row.id),
			name: text(row.name),
			tokenHash: text(row.token_hash),
			createdAt: num(row.created_at),
			lastSeenAt: num(row.last_seen_at),
			revokedAt: nullableNum(row.revoked_at),
		})),
		entities: entities.map((row): Entity => ({
			kind: text(row.kind),
			id: text(row.id),
			data: JSON.parse(text(row.data)),
			clocks: JSON.parse(text(row.clocks)),
		})),
		log: log.map((row): LogEntry => ({
			seq: num(row.seq),
			opId: text(row.op_id),
			kind: text(row.kind),
			id: text(row.id),
			fields: JSON.parse(text(row.fields)),
		})),
		push: push.map((row): PushTarget => ({
			deviceId: text(row.device_id),
			subscription: JSON.parse(text(row.subscription)),
			notifications: JSON.parse(text(row.notifications)),
			deliveredThrough: num(row.delivered_through),
		})),
		ramble: ramble.map(row => ({ day: text(row.day), seconds: num(row.seconds) })),
		epoch: num(meta[0]?.value),
	};
}

/** Loads one user's rows into memory. `flush` replaces that user's rows and leaves everyone else. */
export async function accountSession(client: Client, userId: string): Promise<AccountSession> {
	await ensureSchema(client);
	const store = memoryStore(await readTables(client, userId));
	return {
		store,
		flush: async () => {
			await client.batch(statements(userId, store.tables()), 'write');
		},
	};
}

export function tursoSession(url: string, authToken: string, userId: string): Promise<AccountSession> {
	return accountSession(createClient({ url, authToken }), userId);
}
