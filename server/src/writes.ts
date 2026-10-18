import { and, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Actor } from '../../shared/auth';
import { access, comments, ENTITY_TABLES, log, tasks } from '../../shared/db/schema';
import type { FieldsByKind, Kind } from '../../shared/model';
import { coalesce, TABLE_OF, type RowWrite } from '../../shared/rows';
import type { Fields } from '../../shared/snapshot';
import { guestRefusal, type StoredComment } from '../../shared/scope';
import type { Client } from '../../shared/values';
import { asGuest, recomputeAccess, touchesAccess } from './access';
import type { Db } from './db/postgres';
import { replan, touchesPush } from './push';

/**
 * The one way rows change. Every write is one single-row statement with the ownership check and the authorship
 * stamps inside it, so it needs no transaction, no lock, and no read of the space: Postgres makes the row atomic, and
 * every write converges when replayed (a put upserts, a patch sets values, a delete removes), so PowerSync resending
 * a batch is harmless. A batch's statements run without waiting on each other. Afterwards one `log` insert records
 * the writes that changed a row, and the `access` rows and the push plan are recomputed only when a write touched
 * what they derive from.
 */

export type Write = RowWrite & { opId: string };
/** A write with the space it names: a `put` carries its `user_id`; a `patch` or `delete` learns it from the row. */
export type OwnedWrite = Write & { owner: string | null };
export type Rejected = { table: string; id: string; reason: string };
export type WriteContext = { actor: Actor; client: Client; now: number };
export type Applied = { rejected: Rejected[] };

/**
 * The actor's standing in one space, which the agent API decides from the loaded space before it writes: the owner,
 * an AI manager with the owner's rights, or a guest whose writes are checked against their `access` rows, read with
 * the writes by `asGuest`, with `comment` answering what the server holds for a comment they write to.
 */
export type Authority =
	| { role: 'owner' }
	| { role: 'manager' }
	| { role: 'guest'; comment: (id: string) => StoredComment | undefined };

const OTHER_SPACE = 'Belongs to another space';
const DB_REFUSED = 'The database refused the write';
const authorOnly = (op: RowWrite['op']) =>
	op === 'delete' ? 'Only the author can delete a comment' : 'Only the author can edit a comment';

/** The tables whose rows are keyed by `(user_id, id)` and always the actor's own; the rest are keyed by `id` alone. */
const PER_USER: ReadonlySet<Kind> = new Set<Kind>(['read', 'settings']);

const columnsOf = (kind: Kind) => getTableColumns(ENTITY_TABLES[kind] as PgTable) as Record<string, PgColumn>;

const rowKey = (write: Pick<RowWrite, 'kind' | 'id'>) => `${write.kind}:${write.id}`;
const reject = (write: Pick<RowWrite, 'kind' | 'id'>, reason: string): Rejected => ({
	table: TABLE_OF[write.kind],
	id: write.id,
	reason,
});

/** `excluded.<column>` for each named field, which an upsert's update reads from the row it tried to insert. */
function excluded(columns: Record<string, PgColumn>, names: readonly string[]): Record<string, SQL> {
	return Object.fromEntries(
		names.filter(name => columns[name]).map(name => [name, sql`excluded.${sql.identifier(columns[name]!.name)}`]),
	);
}

type TaskFields = Partial<FieldsByKind['task']>;
type CommentFields = Partial<FieldsByKind['comment']>;

/**
 * `completed_by` follows `completed_at`, a recurring roll included through `last_completed_at`: the actor when either
 * moves, null when `completed_at` clears, and otherwise what the row holds. `completedAt` and `lastCompletedAt` are
 * the new values as SQL (`excluded.*` in an upsert, the parameter in a patch), present when the write sets them.
 */
function completedBy(actor: string, completedAt: { value: SQL; cleared: SQL } | null, lastCompletedAt: SQL | null) {
	const cases: SQL[] = [];
	if (completedAt) {
		cases.push(
			sql`WHEN ${tasks.completedAt} IS DISTINCT FROM ${completedAt.value} THEN CASE WHEN ${completedAt.cleared} THEN NULL ELSE ${actor} END`,
		);
	}
	if (lastCompletedAt) cases.push(sql`WHEN ${tasks.lastCompletedAt} IS DISTINCT FROM ${lastCompletedAt} THEN ${actor}`);
	return sql`CASE ${sql.join(cases, sql` `)} ELSE ${tasks.completedBy} END`;
}

/** What a write's results are filed into, for the log and derived work or for the client's notice. */
type Results = { landed: Landed[]; rejected: Rejected[] };

/**
 * Runs one write in `owner`'s space, files a change in `landed` and a data or integrity error (SQLSTATE 22xxx or
 * 23xxx, the client's data's fault) in `rejected`, and answers whether it changed nothing. Inside a transaction a
 * refused statement would abort the rest, so there each write gets a savepoint of its own.
 */
async function land(db: Db, owner: string, actor: string, write: Write, results: Results, inTransaction = false) {
	let changed: boolean;
	try {
		changed = inTransaction
			? await db.transaction(savepoint => statement(savepoint, owner, actor, write))
			: await statement(db, owner, actor, write);
	} catch (error) {
		if (!refusedByDatabase(error)) throw error;
		results.rejected.push(reject(write, DB_REFUSED));
		return false;
	}
	if (changed) results.landed.push({ owner, write });
	return !changed;
}

/**
 * One row, one statement, in `owner`'s space. A put inserts with the stamps and otherwise updates the row only while
 * it is in that space; a patch or a delete names the space in its `WHERE`. A comment's author is stamped on insert,
 * and its edits and deletes only ever match the author's own row. Answers whether a row changed.
 */
async function statement(db: Db, owner: string, actor: string, write: Write): Promise<boolean> {
	const table: PgTable = ENTITY_TABLES[write.kind];
	const columns = columnsOf(write.kind);
	const own = PER_USER.has(write.kind)
		? and(eq(columns.userId!, actor), eq(columns.id!, write.id))
		: and(eq(columns.userId!, owner), eq(columns.id!, write.id));
	const returning = { id: columns.id! };

	if (write.op === 'delete') {
		const where = write.kind === 'comment' ? and(own, eq(comments.authorId, actor)) : own;
		return (await db.delete(table).where(where).returning(returning)).length > 0;
	}

	if (write.kind === 'task') {
		const { createdBy: _, completedBy: __, ...fields } = write.values as TaskFields;
		const names = Object.keys(fields);
		if (write.op === 'put') {
			const completed = (fields.completedAt ?? null) !== null || (fields.lastCompletedAt ?? null) !== null;
			const rows = await db
				.insert(tasks)
				.values({
					...(fields as typeof tasks.$inferInsert),
					id: write.id,
					userId: owner,
					createdBy: actor,
					completedBy: completed ? actor : null,
				})
				.onConflictDoUpdate({
					target: tasks.id,
					set: {
						...excluded(columns, names),
						completedBy: completedBy(
							actor,
							{ value: sql`excluded.completed_at`, cleared: sql`excluded.completed_at IS NULL` },
							sql`excluded.last_completed_at`,
						),
					},
					setWhere: eq(tasks.userId, sql`excluded.user_id`),
				})
				.returning(returning);
			return rows.length > 0;
		}
		if (!names.length) return false;
		const stamps =
			'completedAt' in fields || 'lastCompletedAt' in fields
				? {
						completedBy: completedBy(
							actor,
							'completedAt' in fields
								? { value: sql`${fields.completedAt}`, cleared: sql`${fields.completedAt === null}` }
								: null,
							'lastCompletedAt' in fields ? sql`${fields.lastCompletedAt}` : null,
						),
					}
				: {};
		return (
			(
				await db
					.update(tasks)
					.set({ ...fields, ...stamps })
					.where(own)
					.returning(returning)
			).length > 0
		);
	}

	if (write.kind === 'comment') {
		const { authorId: _, taskId, createdAt, ...fields } = write.values as CommentFields;
		if (write.op === 'put') {
			const rows = await db
				.insert(comments)
				.values({
					...(fields as typeof comments.$inferInsert),
					taskId: taskId!,
					createdAt: createdAt!,
					id: write.id,
					userId: owner,
					authorId: actor,
				})
				.onConflictDoUpdate({
					target: comments.id,
					set: excluded(columns, Object.keys(fields)),
					setWhere: and(eq(comments.userId, sql`excluded.user_id`), eq(comments.authorId, actor)),
				})
				.returning(returning);
			return rows.length > 0;
		}
		if (!Object.keys(fields).length) return false;
		const where = and(own, eq(comments.authorId, actor));
		return (await db.update(comments).set(fields).where(where).returning(returning)).length > 0;
	}

	const values = write.values ?? {};
	if (write.op === 'put') {
		const row = { ...values, id: write.id, userId: PER_USER.has(write.kind) ? actor : owner };
		const insert = db.insert(table).values(row);
		const upsert =
			write.kind === 'settings'
				? insert.onConflictDoNothing()
				: PER_USER.has(write.kind)
					? insert.onConflictDoUpdate({
							target: [columns.userId!, columns.id!],
							set: excluded(columns, Object.keys(values)),
						})
					: insert.onConflictDoUpdate({
							target: columns.id!,
							set: excluded(columns, Object.keys(values)),
							setWhere: eq(columns.userId!, sql`excluded.user_id`),
						});
		return (await upsert.returning(returning)).length > 0;
	}
	if (!Object.keys(values).length) return false;
	return (await db.update(table).set(values).where(own).returning(returning)).length > 0;
}

type Stored = { userId: string } & Partial<StoredComment>;

/** The stored row behind each write, for the writes whose first statement changed nothing: one select per table. */
async function storedRows(db: Db, writes: readonly Write[]): Promise<Map<string, Stored>> {
	const found = new Map<string, Stored>();
	await Promise.all(
		[...Map.groupBy(writes, write => write.kind)].map(async ([kind, group]) => {
			const ids = [...new Set(group.map(write => write.id))];
			if (kind === 'comment') {
				const rows = await db
					.select({ id: comments.id, userId: comments.userId, taskId: comments.taskId, authorId: comments.authorId })
					.from(comments)
					.where(inArray(comments.id, ids));
				for (const { id, ...rest } of rows) found.set(`${kind}:${id}`, rest);
				return;
			}
			const columns = columnsOf(kind);
			const rows = await db
				.select({ id: columns.id!, userId: columns.userId! })
				.from(ENTITY_TABLES[kind] as PgTable)
				.where(inArray(columns.id!, ids));
			for (const row of rows) found.set(`${kind}:${row.id as string}`, { userId: row.userId as string });
		}),
	);
	return found;
}

type Landed = { owner: string; write: Write };

/** A guest's writes lock their rows in one transaction; running them in id order keeps two batches from deadlocking. */
const inLockOrder = <T extends Pick<RowWrite, 'kind' | 'id'>>(writes: readonly T[]) =>
	writes.toSorted((a, b) => rowKey(a).localeCompare(rowKey(b)));

/**
 * The upload route's writes, to whichever spaces they name. A write to the actor's own space runs at once. A put
 * that then changed nothing names a row stored in another space. A patch or a delete that changed nothing is looked
 * up: gone, which is how a delete beats an edit that arrives after it, or stored in another space, which makes it a
 * guest's write. A guest's writes are checked against the guest's `access` rows in that space, one query per space.
 */
export async function applyWrites(db: Db, ctx: WriteContext, writes: readonly OwnedWrite[]): Promise<Applied> {
	const actor = ctx.actor.id;
	const results: Results = { landed: [], rejected: [] };
	const { landed, rejected } = results;
	const unresolved: Write[] = [];
	const foreign: (Write & { owner: string; stored?: StoredComment })[] = [];

	await Promise.all(
		coalesce(writes).map(({ owner, ...write }) => {
			if (write.op === 'put' && !PER_USER.has(write.kind) && owner !== actor) {
				foreign.push({ ...write, owner: owner! });
				return;
			}
			return land(db, actor, actor, write, results).then(missed => {
				if (!missed) return;
				// A settings put that found the row changed nothing on purpose; a comment put may have met another's row.
				if (write.op !== 'put' || write.kind === 'comment') unresolved.push(write);
				else if (!PER_USER.has(write.kind)) rejected.push(reject(write, OTHER_SPACE));
			});
		}),
	);

	const stored = await storedRows(
		db,
		unresolved.filter(write => !PER_USER.has(write.kind)),
	);
	const gone = unresolved.filter(write => write.op === 'delete' && !stored.has(rowKey(write)));
	if (gone.length) landed.push(...(await spacesOfGone(db, actor, gone)));
	for (const write of unresolved) {
		const row = stored.get(rowKey(write));
		if (!row) continue;
		if (row.userId === actor) rejected.push(reject(write, authorOnly(write.op)));
		else
			foreign.push({
				...write,
				owner: row.userId,
				stored: row.taskId ? { taskId: row.taskId, authorId: row.authorId ?? null } : undefined,
			});
	}

	for (const [owner, group] of Map.groupBy(foreign, write => write.owner)) {
		await asGuest(db, actor, owner, async (tx, rows) => {
			if (!rows.length) {
				rejected.push(...group.map(write => reject(write, 'Not shared with you')));
				return;
			}
			for (const { owner: space, stored, ...write } of inLockOrder(group)) {
				const reason = guestRefusal(rows, write, actor, stored);
				if (reason) rejected.push(reject(write, reason));
				else if (await land(tx, space, actor, write, results, true)) missedPut(rejected, write);
			}
		});
	}

	await finish(db, ctx, landed);
	return { rejected };
}

/**
 * A delete whose row is already gone may be the retry of one that removed it and then failed before its log row and
 * derived work, so it counts as landed: the log insert ignores an op id it already holds, and the derived work
 * converges. The row was in the space where the actor last wrote it, which a retry of a delete that did reach the log
 * finds even after its recompute dropped the actor's `access` row; else in the space of a task the actor holds an
 * `edit` row for; else in the actor's own.
 */
async function spacesOfGone(db: Db, actor: string, gone: readonly Write[]): Promise<Landed[]> {
	const taskIds = gone.filter(write => write.kind === 'task').map(write => write.id);
	const [written, shared] = await Promise.all([
		db
			.selectDistinctOn([log.kind, log.id], { kind: log.kind, id: log.id, owner: log.userId })
			.from(log)
			.where(
				and(
					inArray(
						log.id,
						gone.map(write => write.id),
					),
					eq(log.actor, actor),
				),
			)
			.orderBy(log.kind, log.id, desc(log.seq)),
		taskIds.length
			? db
					.select({ id: access.entityId, owner: access.owner })
					.from(access)
					.where(
						and(
							eq(access.grantee, actor),
							eq(access.kind, 'task'),
							eq(access.role, 'edit'),
							inArray(access.entityId, taskIds),
						),
					)
			: [],
	]);
	const ownerOf = new Map<string, string>([
		...shared.map(row => [`task:${row.id}`, row.owner] as const),
		...written.map(row => [`${row.kind}:${row.id}`, row.owner] as const),
	]);
	return gone.map(write => ({ owner: ownerOf.get(rowKey(write)) ?? actor, write }));
}

/** A put into a known space that changed nothing met a row it may not rewrite; a patch or delete met none. */
function missedPut(rejected: Rejected[], missed: Write) {
	if (missed.op !== 'put' || PER_USER.has(missed.kind)) return;
	rejected.push(reject(missed, missed.kind === 'comment' ? authorOnly('put') : OTHER_SPACE));
}

/**
 * The agent API's writes to one space, whose authority the caller decided from the loaded space. A write that
 * changed nothing names a row that is gone, or a comment that is not the actor's, which the agent rules already
 * refused in memory.
 */
export async function applyAs(
	db: Db,
	ctx: WriteContext,
	owner: string,
	authority: Authority,
	writes: readonly Write[],
): Promise<Applied> {
	const actor = ctx.actor.id;
	const results: Results = { landed: [], rejected: [] };
	const { landed, rejected } = results;
	const coalesced = coalesce(writes);
	if (authority.role !== 'guest') {
		await Promise.all(
			coalesced.map(async write => {
				if (await land(db, owner, actor, write, results)) missedPut(rejected, write);
			}),
		);
	} else {
		await asGuest(db, actor, owner, async (tx, rows) => {
			for (const write of inLockOrder(coalesced)) {
				const reason = PER_USER.has(write.kind) ? null : guestRefusal(rows, write, actor, authority.comment(write.id));
				if (reason) rejected.push(reject(write, reason));
				else if (await land(tx, owner, actor, write, results, true)) missedPut(rejected, write);
			}
		});
	}
	await finish(db, ctx, landed);
	return { rejected };
}

const logRow = ({ owner, write }: Landed, { actor, client, now }: WriteContext): typeof log.$inferInsert => ({
	userId: owner,
	opId: write.opId,
	kind: write.kind,
	id: write.id,
	op: write.op,
	fields: (write.values ?? {}) as Fields,
	actor: actor.id,
	client,
	at: now,
});

/**
 * One log insert for the writes that changed a row, which a retried batch's op ids make a no-op, then the derived
 * work each space needs: the `access` rows when a write moved what a guest may see, the push plan when a write moved
 * when a notification is due.
 */
async function finish(db: Db, ctx: WriteContext, landed: readonly Landed[]): Promise<void> {
	if (!landed.length) return;
	await db
		.insert(log)
		.values(landed.map(entry => logRow(entry, ctx)))
		.onConflictDoNothing({ target: [log.userId, log.opId] });
	await Promise.all(
		[...Map.groupBy(landed, entry => entry.owner)].map(async ([owner, group]) => {
			const writes = group.map(entry => entry.write);
			if (writes.some(touchesPush)) await replan(db, owner, ctx.now);
			if (writes.some(touchesAccess)) await recomputeAccess(db, owner);
		}),
	);
}

/** Drizzle wraps the driver's error, which holds the SQLSTATE, as `cause`. */
function refusedByDatabase(error: unknown): boolean {
	const wrapped = error as { code?: unknown; cause?: { code?: unknown } } | null;
	const code = wrapped?.code ?? wrapped?.cause?.code;
	return typeof code === 'string' && (code.startsWith('22') || code.startsWith('23'));
}
