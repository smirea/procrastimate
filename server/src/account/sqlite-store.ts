import { and, asc, eq, gt, isNull, max, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { devices, entities, log, meta, push, rambleUsage } from '../../../shared/db/schema';
import { deviceColumns, entityColumns, logColumns, pushColumns } from '../db/columns';
import { migrateSync, type SyncDatabase } from '../db/migrate';
import type { AccountStore } from './store';

/**
 * One user's account in a synchronous SQLite database: the `Account` Durable Object's storage on the Worker, and
 * `bun:sqlite` in tests. Durable Object cursors can run lazily, so every read is drained with `all` or `get`.
 */
export function sqliteStore(db: SyncDatabase, userId: string): AccountStore {
	migrateSync(db);
	const own = (column: AnySQLiteColumn) => eq(column, userId);

	return {
		transaction: run => db.transaction(() => run()),

		addDevice: device => {
			db.insert(devices)
				.values({ ...device, userId })
				.run();
		},
		deviceByTokenHash: tokenHash =>
			db
				.select(deviceColumns)
				.from(devices)
				.where(and(own(devices.userId), eq(devices.tokenHash, tokenHash)))
				.get() ?? null,
		hasDevice: id =>
			db
				.select({ id: devices.id })
				.from(devices)
				.where(and(own(devices.userId), eq(devices.id, id)))
				.get() !== undefined,
		liveDevices: () =>
			db
				.select(deviceColumns)
				.from(devices)
				.where(and(own(devices.userId), isNull(devices.revokedAt)))
				.orderBy(asc(devices.createdAt), asc(devices.id))
				.all(),
		touchDevice: (id, at) => {
			db.update(devices)
				.set({ lastSeenAt: at })
				.where(and(own(devices.userId), eq(devices.id, id)))
				.run();
		},
		revokeDevice: (id, at) => {
			const revoked = db
				.update(devices)
				.set({ revokedAt: at })
				.where(and(own(devices.userId), eq(devices.id, id), isNull(devices.revokedAt)))
				.returning({ id: devices.id })
				.all();
			if (revoked.length) {
				db.delete(push)
					.where(and(own(push.userId), eq(push.deviceId, id)))
					.run();
			}
			return revoked.length > 0;
		},

		entity: (kind, id) =>
			db
				.select(entityColumns)
				.from(entities)
				.where(and(own(entities.userId), eq(entities.kind, kind), eq(entities.id, id)))
				.get() ?? null,
		entities: () =>
			db
				.select(entityColumns)
				.from(entities)
				.where(own(entities.userId))
				.orderBy(asc(entities.kind), asc(entities.id))
				.all(),
		putEntity: entity => {
			db.insert(entities)
				.values({ ...entity, userId })
				.onConflictDoUpdate({
					target: [entities.userId, entities.kind, entities.id],
					set: { data: entity.data, clocks: entity.clocks },
				})
				.run();
		},

		appendLog: entry => {
			const seq = lastSeq() + 1;
			db.insert(log)
				.values({ ...entry, seq, userId })
				.run();
			return seq;
		},
		logAfter: (after, limit) =>
			db
				.select(logColumns)
				.from(log)
				.where(and(own(log.userId), gt(log.seq, after)))
				.orderBy(asc(log.seq))
				.limit(limit)
				.all(),
		hasOp: opId =>
			db
				.select({ seq: log.seq })
				.from(log)
				.where(and(own(log.userId), eq(log.opId, opId)))
				.limit(1)
				.get() !== undefined,
		lastSeq: () => lastSeq(),
		clearTaskData: () => {
			db.delete(entities).where(own(entities.userId)).run();
			db.delete(log).where(own(log.userId)).run();
		},
		clearAccount: () => {
			for (const table of [devices, entities, log, push, rambleUsage, meta])
				db.delete(table).where(own(table.userId)).run();
		},
		epoch: () =>
			Number(
				db
					.select({ value: meta.value })
					.from(meta)
					.where(and(own(meta.userId), eq(meta.key, 'epoch')))
					.get()?.value ?? 0,
			),
		setEpoch: epoch => {
			db.insert(meta)
				.values({ userId, key: 'epoch', value: String(epoch) })
				.onConflictDoUpdate({ target: [meta.userId, meta.key], set: { value: String(epoch) } })
				.run();
		},

		pushTargets: () => db.select(pushColumns).from(push).where(own(push.userId)).orderBy(asc(push.deviceId)).all(),
		putPushTarget: target => {
			const { deviceId: _, ...values } = target;
			db.insert(push)
				.values({ ...target, userId })
				.onConflictDoUpdate({ target: [push.userId, push.deviceId], set: values })
				.run();
		},
		deletePushTarget: deviceId => {
			db.delete(push)
				.where(and(own(push.userId), eq(push.deviceId, deviceId)))
				.run();
		},

		rambleSeconds: day =>
			db
				.select({ seconds: rambleUsage.seconds })
				.from(rambleUsage)
				.where(and(own(rambleUsage.userId), eq(rambleUsage.day, day)))
				.get()?.seconds ?? 0,
		addRambleSeconds: (day, seconds) => {
			db.insert(rambleUsage)
				.values({ userId, day, seconds })
				.onConflictDoUpdate({
					target: [rambleUsage.userId, rambleUsage.day],
					set: { seconds: sql`${rambleUsage.seconds} + excluded.seconds` },
				})
				.run();
		},
	};

	function lastSeq() {
		return (
			db
				.select({ seq: max(log.seq) })
				.from(log)
				.where(own(log.userId))
				.get()?.seq ?? 0
		);
	}
}
