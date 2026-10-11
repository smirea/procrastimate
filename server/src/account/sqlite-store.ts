import type { AccountStore, Device, Entity, LogEntry, PushTarget } from './store';

type SqlValue = ArrayBuffer | string | number | null;
type Row = Record<string, SqlValue>;

/** The slice of Durable Object `SqlStorage` the store uses, so tests can back it with `bun:sqlite`. */
export type Sql = { exec<T extends Row>(query: string, ...bindings: SqlValue[]): { toArray(): T[] } };

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS entities (
		kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, clocks TEXT NOT NULL, PRIMARY KEY (kind, id))`,
	`CREATE TABLE IF NOT EXISTS log (
		seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
		fields TEXT NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS log_op_id ON log (op_id)`,
	`CREATE TABLE IF NOT EXISTS devices (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
		last_seen_at INTEGER NOT NULL, revoked_at INTEGER)`,
	`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS push (
		device_id TEXT PRIMARY KEY, subscription TEXT NOT NULL, notifications TEXT NOT NULL,
		delivered_through INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS ramble_usage (day TEXT PRIMARY KEY, seconds REAL NOT NULL)`,
];

type DeviceRow = {
	id: string;
	name: string;
	token_hash: string;
	created_at: number;
	last_seen_at: number;
	revoked_at: number | null;
};
type EntityRow = { kind: string; id: string; data: string; clocks: string };
type LogRow = { seq: number; op_id: string; kind: string; id: string; fields: string };
type PushRow = { device_id: string; subscription: string; notifications: string; delivered_through: number };

const toDevice = (row: DeviceRow): Device => ({
	id: row.id,
	name: row.name,
	tokenHash: row.token_hash,
	createdAt: row.created_at,
	lastSeenAt: row.last_seen_at,
	revokedAt: row.revoked_at,
});

const toEntity = (row: EntityRow): Entity => ({
	kind: row.kind,
	id: row.id,
	data: JSON.parse(row.data),
	clocks: JSON.parse(row.clocks),
});

const toLogEntry = (row: LogRow): LogEntry => ({
	seq: row.seq,
	opId: row.op_id,
	kind: row.kind,
	id: row.id,
	fields: JSON.parse(row.fields),
});

/** The Worker's account, in the `Account` Durable Object's SQLite database. */
export function sqliteStore(sql: Sql, transactionSync: <T>(run: () => T) => T): AccountStore {
	// Durable Object cursors can run lazily, so every statement is drained right away.
	const all = <T extends Row>(query: string, ...bindings: SqlValue[]) => sql.exec<T>(query, ...bindings).toArray();
	const first = <T extends Row>(query: string, ...bindings: SqlValue[]): T | null =>
		all<T>(query, ...bindings)[0] ?? null;

	for (const statement of SCHEMA) all(statement);

	return {
		transaction: transactionSync,

		addDevice: device => {
			all(
				'INSERT INTO devices (id, name, token_hash, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)',
				device.id,
				device.name,
				device.tokenHash,
				device.createdAt,
				device.lastSeenAt,
				device.revokedAt,
			);
		},
		deviceByTokenHash: tokenHash => {
			const row = first<DeviceRow>('SELECT * FROM devices WHERE token_hash = ?', tokenHash);
			return row ? toDevice(row) : null;
		},
		hasDevice: id => first('SELECT 1 AS found FROM devices WHERE id = ?', id) !== null,
		liveDevices: () =>
			all<DeviceRow>('SELECT * FROM devices WHERE revoked_at IS NULL ORDER BY created_at, id').map(toDevice),
		touchDevice: (id, at) => {
			all('UPDATE devices SET last_seen_at = ? WHERE id = ?', at, id);
		},
		revokeDevice: (id, at) => {
			const revoked = all<{ id: string }>(
				'UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING id',
				at,
				id,
			);
			if (revoked.length) all('DELETE FROM push WHERE device_id = ?', id);
			return revoked.length > 0;
		},

		entity: (kind, id) => {
			const row = first<EntityRow>('SELECT * FROM entities WHERE kind = ? AND id = ?', kind, id);
			return row ? toEntity(row) : null;
		},
		entities: () => all<EntityRow>('SELECT * FROM entities ORDER BY kind, id').map(toEntity),
		putEntity: entity => {
			all(
				'INSERT OR REPLACE INTO entities (kind, id, data, clocks) VALUES (?, ?, ?, ?)',
				entity.kind,
				entity.id,
				JSON.stringify(entity.data),
				JSON.stringify(entity.clocks),
			);
		},

		appendLog: entry =>
			first<{ seq: number }>(
				'INSERT INTO log (op_id, kind, id, fields) VALUES (?, ?, ?, ?) RETURNING seq',
				entry.opId,
				entry.kind,
				entry.id,
				JSON.stringify(entry.fields),
			)!.seq,
		logAfter: (after, limit) =>
			all<LogRow>('SELECT * FROM log WHERE seq > ? ORDER BY seq LIMIT ?', after, limit).map(toLogEntry),
		hasOp: opId => first('SELECT 1 AS found FROM log WHERE op_id = ? LIMIT 1', opId) !== null,
		lastSeq: () => first<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM log')?.seq ?? 0,
		clearTaskData: () => {
			all('DELETE FROM entities');
			all('DELETE FROM log');
		},
		epoch: () => Number(first<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'epoch')?.value ?? 0),
		setEpoch: epoch => {
			all('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'epoch', String(epoch));
		},

		pushTargets: () =>
			all<PushRow>('SELECT * FROM push ORDER BY device_id').map((row): PushTarget => ({
				deviceId: row.device_id,
				subscription: JSON.parse(row.subscription),
				notifications: JSON.parse(row.notifications),
				deliveredThrough: row.delivered_through,
			})),
		putPushTarget: target => {
			all(
				'INSERT OR REPLACE INTO push (device_id, subscription, notifications, delivered_through) VALUES (?, ?, ?, ?)',
				target.deviceId,
				JSON.stringify(target.subscription),
				JSON.stringify(target.notifications),
				target.deliveredThrough,
			);
		},
		deletePushTarget: deviceId => {
			all('DELETE FROM push WHERE device_id = ?', deviceId);
		},

		rambleSeconds: day =>
			first<{ seconds: number }>('SELECT seconds FROM ramble_usage WHERE day = ?', day)?.seconds ?? 0,
		addRambleSeconds: (day, seconds) => {
			all(
				'INSERT INTO ramble_usage (day, seconds) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET seconds = seconds + excluded.seconds',
				day,
				seconds,
			);
		},
	};
}
