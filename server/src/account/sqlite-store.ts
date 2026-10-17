import { and, asc, eq, gt, isNull, max, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
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
	shareColumns,
	taskClientsColumns,
} from '../db/columns';
import { migrateSync, type MigrateMode, type SyncDatabase } from '../db/migrate';
import type { AccountStore } from './store';

/**
 * One user's account in a synchronous SQLite database: the `Account` Durable Object's storage on the Worker, and
 * `bun:sqlite` in tests. Durable Object cursors can run lazily, so every read is drained with `all` or `get`.
 */
export function sqliteStore(db: SyncDatabase, userId: string, mode: MigrateMode): AccountStore {
	migrateSync(db, mode);
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

		entity: (kind, id) => {
			const table = ENTITY_TABLES[kind];
			const row = db
				.select()
				.from(table)
				.where(and(own(table.userId), eq(table.id, id)))
				.get();
			return row ? rowEntity(kind, row) : null;
		},
		entities: () =>
			KINDS.flatMap(kind => {
				const table = ENTITY_TABLES[kind];
				const rows = db.select().from(table).where(own(table.userId)).orderBy(asc(table.id)).all();
				return rows.map(row => rowEntity(kind, row));
			}),
		putEntity: entity => {
			const table = ENTITY_TABLES[entity.kind];
			const { userId: _, id: __, ...set } = entityRow(userId, entity);
			db.insert(table)
				.values(entityRow(userId, entity))
				.onConflictDoUpdate({ target: [table.userId, table.id], set })
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
		taskClients: id =>
			db
				.select(taskClientsColumns)
				.from(taskClients)
				.where(and(own(taskClients.userId), eq(taskClients.id, id)))
				.get() ?? null,
		putTaskClients: row => {
			const { id: _, ...set } = row;
			db.insert(taskClients)
				.values({ ...row, userId })
				.onConflictDoUpdate({ target: [taskClients.userId, taskClients.id], set })
				.run();
		},
		clearTaskData: () => {
			for (const table of [...Object.values(ENTITY_TABLES), log]) db.delete(table).where(own(table.userId)).run();
		},
		clearAccount: () => {
			for (const table of [
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
			]) {
				db.delete(table).where(own(table.userId)).run();
			}
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

		shares: () =>
			db
				.select(shareColumns)
				.from(shares)
				.where(own(shares.userId))
				.orderBy(asc(shares.createdAt), asc(shares.id))
				.all(),
		putShare: share => {
			const { id: _, ...set } = share;
			db.insert(shares)
				.values({ ...share, userId })
				.onConflictDoUpdate({ target: [shares.userId, shares.id], set })
				.run();
		},
		deleteShare: id => {
			db.delete(shares)
				.where(and(own(shares.userId), eq(shares.id, id)))
				.run();
		},

		memberships: () =>
			db
				.select(membershipColumns)
				.from(memberships)
				.where(own(memberships.userId))
				.orderBy(asc(memberships.createdAt), asc(memberships.spaceId))
				.all(),
		putMembership: membership => {
			const { spaceId: _, ...set } = membership;
			db.insert(memberships)
				.values({ ...membership, userId })
				.onConflictDoUpdate({ target: [memberships.userId, memberships.spaceId], set })
				.run();
		},
		deleteMembership: spaceId => {
			db.delete(memberships)
				.where(and(own(memberships.userId), eq(memberships.spaceId, spaceId)))
				.run();
		},

		people: () => db.select(personColumns).from(people).where(own(people.userId)).orderBy(asc(people.id)).all(),
		upsertPerson: person => {
			const { id: _, ...set } = person;
			db.insert(people)
				.values({ ...person, userId })
				.onConflictDoUpdate({ target: [people.userId, people.id], set })
				.run();
		},

		apiTokens: () =>
			db
				.select(apiTokenColumns)
				.from(apiTokens)
				.where(own(apiTokens.userId))
				.orderBy(asc(apiTokens.createdAt), asc(apiTokens.id))
				.all(),
		putApiToken: token => {
			const { id: _, ...set } = token;
			db.insert(apiTokens)
				.values({ ...token, userId })
				.onConflictDoUpdate({ target: [apiTokens.userId, apiTokens.id], set })
				.run();
		},
		deleteApiToken: id => {
			db.delete(apiTokens)
				.where(and(own(apiTokens.userId), eq(apiTokens.id, id)))
				.run();
		},
		apiTokenByHash: tokenHash =>
			db
				.select(apiTokenColumns)
				.from(apiTokens)
				.where(and(own(apiTokens.userId), eq(apiTokens.tokenHash, tokenHash)))
				.get() ?? null,
		touchApiToken: (id, at) => {
			db.update(apiTokens)
				.set({ lastUsedAt: at })
				.where(and(own(apiTokens.userId), eq(apiTokens.id, id)))
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
