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
		kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, clocks TEXT NOT NULL, PRIMARY KEY (kind, id))`,
	`CREATE TABLE IF NOT EXISTS log (
		seq INTEGER PRIMARY KEY, op_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, fields TEXT NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS log_op_id ON log (op_id)`,
	`CREATE TABLE IF NOT EXISTS devices (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
		last_seen_at INTEGER NOT NULL, revoked_at INTEGER)`,
	`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS push (
		device_id TEXT PRIMARY KEY, subscription TEXT NOT NULL, notifications TEXT NOT NULL,
		delivered_through INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS ramble_usage (day TEXT PRIMARY KEY, seconds REAL NOT NULL)`,
].join(';\n');

type Row = Record<string, unknown>;

const text = (value: unknown) => (value == null ? '' : String(value));
const num = (value: unknown) => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0));
const nullableNum = (value: unknown) => (value == null ? null : num(value));

function statements(tables: AccountTables): InStatement[] {
	const writes: InStatement[] = [
		'DELETE FROM devices',
		'DELETE FROM entities',
		'DELETE FROM log',
		'DELETE FROM push',
		'DELETE FROM ramble_usage',
		'DELETE FROM meta',
		{ sql: 'INSERT INTO meta (key, value) VALUES (?, ?)', args: ['epoch', String(tables.epoch)] },
	];
	for (const device of tables.devices) {
		writes.push({
			sql: 'INSERT INTO devices (id, name, token_hash, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)',
			args: [device.id, device.name, device.tokenHash, device.createdAt, device.lastSeenAt, device.revokedAt],
		});
	}
	for (const entity of tables.entities) {
		writes.push({
			sql: 'INSERT INTO entities (kind, id, data, clocks) VALUES (?, ?, ?, ?)',
			args: [entity.kind, entity.id, JSON.stringify(entity.data), JSON.stringify(entity.clocks)],
		});
	}
	for (const entry of tables.log) {
		writes.push({
			sql: 'INSERT INTO log (seq, op_id, kind, id, fields) VALUES (?, ?, ?, ?, ?)',
			args: [entry.seq, entry.opId, entry.kind, entry.id, JSON.stringify(entry.fields)],
		});
	}
	for (const target of tables.push) {
		writes.push({
			sql: 'INSERT INTO push (device_id, subscription, notifications, delivered_through) VALUES (?, ?, ?, ?)',
			args: [
				target.deviceId,
				JSON.stringify(target.subscription),
				JSON.stringify(target.notifications),
				target.deliveredThrough,
			],
		});
	}
	for (const row of tables.ramble) {
		writes.push({
			sql: 'INSERT INTO ramble_usage (day, seconds) VALUES (?, ?)',
			args: [row.day, row.seconds],
		});
	}
	return writes;
}

async function select(client: Client, sql: string): Promise<Row[]> {
	const result = await client.execute(sql);
	return result.rows as unknown as Row[];
}

async function readTables(client: Client): Promise<AccountTables> {
	const [devices, entities, log, push, ramble, meta] = await Promise.all([
		select(client, 'SELECT * FROM devices'),
		select(client, 'SELECT * FROM entities'),
		select(client, 'SELECT * FROM log ORDER BY seq'),
		select(client, 'SELECT * FROM push'),
		select(client, 'SELECT * FROM ramble_usage'),
		select(client, "SELECT value FROM meta WHERE key = 'epoch'"),
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

/** Loads the account into memory. `flush` replaces the Turso rows with that memory. */
export async function accountSession(client: Client): Promise<AccountSession> {
	await client.executeMultiple(SCHEMA);
	const store = memoryStore(await readTables(client));
	return {
		store,
		flush: async () => {
			await client.batch(statements(store.tables()), 'write');
		},
	};
}

export function tursoSession(url: string, authToken: string): Promise<AccountSession> {
	return accountSession(createClient({ url, authToken }));
}
