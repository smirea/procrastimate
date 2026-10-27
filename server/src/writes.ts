import { and, eq, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { PulledRow, ServerWrite, ServerWriter, SpaceHooks, Values, View, Write } from 'sync-engine/core';
import type { Actor } from '../../shared/auth';
import { access, comments, ENTITY_TABLES, log, settings } from '../../shared/db/schema';
import { syncSchema } from '../../shared/db/sync';
import { fromWire, toWire } from '../../shared/db/wire';
import { newId } from '../../shared/id';
import type { Kind } from '../../shared/model';
import { KIND_OF, rowIdOf, TABLE_OF, type RowWrite, type SyncedTable } from '../../shared/rows';
import { authorOnly, guestRefusal, type GuestRows, type StoredRow } from '../../shared/scope';
import type { Fields } from '../../shared/snapshot';
import type { Client } from '../../shared/values';
import { recomputeAccess, touchesAccess } from './access';
import type { Db } from './db/sqlite';
import { purgeIfEmptied } from './purge';
import { replan, touchesPush } from './push';

/**
 * The server's rules for every row write, as sync-engine hooks. A device's sync and the agent API's commands reach the
 * same hooks, inside the engine's transaction, so a write and everything derived from it commit together. The Durable
 * Object runs one request at a time and its SQL is synchronous, so nothing here locks.
 *
 * `admit` decides each write: the space it lands in, whether the actor may write there (a guest's write is checked
 * against their `access` rows with `guestRefusal`), and the stamps the server owns (`createdBy`, `completedBy`,
 * `authorId`), whatever the client sent. `landed` logs the writes that counted with their actor and app, then
 * recomputes what derives from them: the push plan, the `access` rows, and the purge of an emptied space.
 */

export type SyncContext = {
	actor: Actor;
	client: Client;
	now: number;
	/** The engine client the writes came from, which names each write's op id; the agent API's have none. */
	clientId: string | null;
	/** Spaces whose owner's rights the actor holds: an AI account that manages them through the agent API. */
	manages: ReadonlySet<string>;
	/** What `admit` learned about each write it let through, by `table:id`, for `landed`. */
	landing: Map<string, Landing>;
	/** The actor's `access` rows per space it wrote to as a guest, grown by the tasks a batch adds. */
	guestRows: Map<string, GuestRowsList>;
};

type GuestRowsList = Pick<typeof access.$inferSelect, 'kind' | 'entityId' | 'role'>[];
type Landing = { owner: string; kind: Kind; fields: Fields };

export function syncContext(
	actor: Actor,
	client: Client,
	options: { now?: number; clientId?: string | null; manages?: Iterable<string> } = {},
): SyncContext {
	return {
		actor,
		client,
		now: options.now ?? Date.now(),
		clientId: options.clientId ?? null,
		manages: new Set(options.manages ?? []),
		landing: new Map(),
		guestRows: new Map(),
	};
}

export const OTHER_SPACE = 'Belongs to another space';
const NOT_SHARED = 'Not shared with you';

const key = (table: string, id: string) => `${table}:${id}`;
const tableOf = (kind: Kind) => ENTITY_TABLES[kind] as SQLiteTable;

type StoredEntity = Fields & { userId: string };

function stored(db: Db, kind: Kind, id: string): StoredEntity | undefined {
	const table = ENTITY_TABLES[kind];
	return db.select().from(table).where(eq(table.id, id)).get() as StoredEntity | undefined;
}

function guestRows(db: Db, ctx: SyncContext, owner: string): GuestRowsList {
	let rows = ctx.guestRows.get(owner);
	if (!rows) {
		rows = db
			.select({ kind: access.kind, entityId: access.entityId, role: access.role })
			.from(access)
			.where(and(eq(access.grantee, ctx.actor.id), eq(access.owner, owner)))
			.all();
		ctx.guestRows.set(owner, rows);
	}
	return rows;
}

const without = (fields: Fields, ...names: string[]) =>
	Object.fromEntries(Object.entries(fields).filter(([name]) => !names.includes(name)));

/**
 * `completedBy` follows `completedAt`, a recurring roll included through `lastCompletedAt`: the actor when either
 * moves, null when `completedAt` clears, and otherwise what the row holds.
 */
function completedBy(actor: string, fields: Fields, before: StoredEntity | undefined): string | null {
	const prior = before ?? { completedAt: null, lastCompletedAt: null, completedBy: null };
	if ('completedAt' in fields && fields.completedAt !== prior.completedAt) {
		return fields.completedAt === null ? null : actor;
	}
	if ('lastCompletedAt' in fields && fields.lastCompletedAt !== prior.lastCompletedAt) return actor;
	return (prior.completedBy as string | null) ?? null;
}

/** The per-user kinds: always the actor's own, and their row ids name the actor. */
function admitOwn(
	db: Db,
	ctx: SyncContext,
	kind: 'read' | 'settings',
	write: Write,
	fields: Fields,
): Fields | string | null {
	const actor = ctx.actor.id;
	if (kind === 'settings') {
		if (write.id !== rowIdOf('settings', '', actor)) return 'Settings belong to their user';
		if (write.op === 'delete') return 'Settings cannot be deleted';
		// The server made the row at sign-up; a client's put only fills it in when it is missing.
		if (write.op === 'put' && db.select({ id: settings.id }).from(settings).where(eq(settings.id, write.id)).get()) {
			return null;
		}
	} else if (!write.id.startsWith(`${actor}:`)) {
		return 'Read markers belong to their reader';
	}
	return write.op === 'put' ? { ...fields, userId: actor } : without(fields, 'userId');
}

function admitEntity(db: Db, ctx: SyncContext, kind: Kind, write: Write, fields: Fields): Fields | string {
	const actor = ctx.actor.id;
	const before = stored(db, kind, write.id);
	if (write.op === 'put' && before && before.userId !== fields.userId) return OTHER_SPACE;
	const owner = before?.userId ?? (write.op === 'put' ? String(fields.userId) : actor);
	let next = write.op === 'put' ? fields : without(fields, 'userId');

	if (owner !== actor && !ctx.manages.has(owner)) {
		const rows = guestRows(db, ctx, owner);
		if (!rows.length) return NOT_SHARED;
		// A guest's undo of a deleted import restores the task without its key, and a re-put keeps the stored one.
		if (kind === 'task')
			next = { ...without(next, 'sourceKey'), ...(write.op === 'put' ? { sourceKey: before?.sourceKey ?? null } : {}) };
		const domain: RowWrite = { op: write.op, kind, id: write.id, values: without(next, 'userId') };
		const reason = guestRefusal(rows as GuestRows, domain, actor, before as StoredRow | undefined);
		if (reason) return reason;
		if (kind === 'task' && write.op === 'put' && !before) rows.push({ kind: 'task', entityId: write.id, role: 'edit' });
	}

	if (kind === 'comment') {
		if (before && before.authorId !== actor) return authorOnly(write.op);
		if (write.op === 'put') {
			next = { ...next, authorId: actor, ...(before ? { taskId: before.taskId, createdAt: before.createdAt } : {}) };
		} else {
			next = without(next, 'authorId', 'taskId', 'createdAt');
		}
	}
	if (kind === 'task') {
		if (write.op === 'put') {
			const completed = next.completedAt != null || next.lastCompletedAt != null;
			next = {
				...next,
				createdBy: before ? (before.createdBy as string | null) : actor,
				completedBy: before ? completedBy(actor, next, before) : completed ? actor : null,
			};
		} else if (write.op === 'patch') {
			next = without(next, 'createdBy', 'completedBy');
			if ('completedAt' in next || 'lastCompletedAt' in next) next.completedBy = completedBy(actor, next, before);
		}
	}
	ctx.landing.set(key(write.table, write.id), { owner, kind, fields: without(next, 'userId', 'id') });
	return next;
}

function admit(db: Db, write: Write, ctx: SyncContext): Write | string | null {
	const kind = KIND_OF[write.table as SyncedTable] as Kind | undefined;
	if (!kind) return `Only the server writes ${write.table}`;
	const table = tableOf(kind);
	const fields = write.op === 'delete' ? {} : fromWire(table, write.values);
	const next =
		kind === 'read' || kind === 'settings'
			? admitOwn(db, ctx, kind, write, fields)
			: admitEntity(db, ctx, kind, write, fields);
	if (next === null || typeof next === 'string') return next;
	if (kind === 'read' || kind === 'settings') {
		ctx.landing.set(key(write.table, write.id), { owner: ctx.actor.id, kind, fields: without(next, 'userId', 'id') });
	}
	if (write.op === 'delete') return write;
	return { ...write, values: toWire(table, without(next, 'id')) };
}

function opId(ctx: SyncContext, write: Write): string {
	return ctx.clientId && write.seq ? `${ctx.clientId}:${write.seq}` : newId();
}

function landed(db: Db, writes: readonly Write[], ctx: SyncContext, server: ServerWriter): void {
	const entries = writes.flatMap(write => {
		const landing = ctx.landing.get(key(write.table, write.id));
		return landing ? [{ write, landing }] : [];
	});
	if (!entries.length) return;
	// One row per statement: a Durable Object binds at most 100 parameters, and a log row takes ten.
	for (const { write, landing } of entries) {
		db.insert(log)
			.values({
				userId: landing.owner,
				opId: opId(ctx, write),
				kind: landing.kind,
				id: write.id,
				op: write.op,
				fields: write.op === 'delete' ? {} : landing.fields,
				actor: ctx.actor.id,
				client: ctx.client,
				at: ctx.now,
			})
			.onConflictDoNothing()
			.run();
	}
	for (const [owner, group] of Map.groupBy(entries, entry => entry.landing.owner)) {
		const domain: RowWrite[] = group.map(({ write, landing }) => ({
			op: write.op,
			kind: landing.kind,
			id: write.id,
			values: landing.fields,
		}));
		if (domain.some(touchesPush)) replan(db, owner, ctx.now);
		if (domain.some(touchesAccess)) recomputeAccess(db, owner, server);
		if (owner === ctx.actor.id && domain.some(write => write.op === 'delete')) purgeIfEmptied(db, owner, server);
	}
}

/**
 * What a reader pulls: their own rows, their `access` rows, and what those name in other spaces, comments through
 * their task. A delta that adds an `access` row of theirs brings the row it opens, with a task's comments, and one
 * that removes it tombstones them.
 */
function view(db: Db, ctx: SyncContext): View {
	const me = ctx.actor.id;
	const granted = new Set(
		db
			.select({ kind: access.kind, entityId: access.entityId, owner: access.owner })
			.from(access)
			.where(eq(access.grantee, me))
			.all()
			.map(row => `${row.owner}:${row.kind}:${row.entityId}`),
	);
	const sees = (table: string, values: Values): boolean => {
		if (table === 'access') return values.grantee === me;
		const owner = values.user_id;
		if (owner === me) return true;
		if (table === 'reads' || table === 'settings') return false;
		if (table === 'comments') return granted.has(`${owner}:task:${values.task_id}`);
		const kind = KIND_OF[table as SyncedTable];
		return granted.has(`${owner}:${kind}:${values.id}`);
	};
	const current = (table: string, id: string): PulledRow | null => {
		const values = wireRow(db, table, id);
		return values ? { table, id, deleted: 0, values } : null;
	};
	return {
		sees,
		expand(rows) {
			const added: PulledRow[] = [];
			for (const row of rows) {
				if (row.table !== 'access' || !row.id.startsWith(`${me}:`)) continue;
				const [, kind, entityId] = row.id.split(':') as [string, Kind, string];
				const table = TABLE_OF[kind];
				const opened = row.deleted ? null : current(table, entityId);
				added.push(opened ?? { table, id: entityId, deleted: 1 });
				if (kind !== 'task') continue;
				for (const comment of db
					.select({ id: comments.id })
					.from(comments)
					.where(eq(comments.taskId, entityId))
					.all()) {
					const found = row.deleted ? null : current('comments', comment.id);
					added.push(found ?? { table: 'comments', id: comment.id, deleted: 1 });
				}
			}
			return added;
		},
	};
}

/** A synced row as the engine sends it: every column of the engine's schema, as stored. */
function wireRow(db: Db, table: string, id: string): Values | null {
	const names = syncSchema.tables.find(t => t.name === table)!.columns.map(c => c.name);
	const columns = sql.join(
		names.map(name => sql.identifier(name)),
		sql`, `,
	);
	// A raw select answers the row as an array of its columns' values, in order.
	const row = db.get<Values[string][] | undefined>(
		sql`SELECT ${columns} FROM ${sql.identifier(table)} WHERE id = ${id}`,
	);
	return row ? Object.fromEntries(names.map((name, i) => [name, row[i]!])) : null;
}

export function syncHooks(db: Db): SpaceHooks<SyncContext> {
	return {
		admit: (write, ctx) => admit(db, write, ctx),
		landed: (writes, ctx, server) => landed(db, writes, ctx, server),
		view: ctx => view(db, ctx),
	};
}

/** A domain row write as the server's own engine write, for the agent API. */
export function serverWrite(write: RowWrite, owner: string): ServerWrite {
	const table = TABLE_OF[write.kind];
	const id = rowIdOf(write.kind, write.id, owner);
	if (write.op === 'delete') return { table, id, op: 'delete' };
	const fields = write.op === 'put' ? { ...write.values, userId: owner } : (write.values ?? {});
	return { table, id, op: write.op, values: toWire(tableOf(write.kind), fields) };
}
