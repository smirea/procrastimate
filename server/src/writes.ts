import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Actor } from '../../shared/auth';
import { ENTITY_TABLES, log, people, taskClients } from '../../shared/db/schema';
import { fixups } from '../../shared/fixups';
import { KINDS, type FieldsByKind, type Kind, type Snapshot } from '../../shared/model';
import { applyWrite, coalesce, rowWrites, sameValue, TABLE_OF, type RowWrite } from '../../shared/rows';
import { admit } from '../../shared/scope';
import type { Fields } from '../../shared/snapshot';
import { SERVER_ACTOR, type Client, type ClientStamp } from '../../shared/values';
import { syncAccess } from './access';
import type { Db } from './db/postgres';
import { sweepImages } from './images';
import { replan } from './push';
import { accessOf, loadSpace, type Space } from './space';

/**
 * The one way rows change: `applyWrites` takes an actor's row writes and applies them to the spaces they name in
 * one transaction. The upload route and the agent commands both end here. Per space it takes an advisory lock,
 * loads the snapshot, admits a guest's writes with `admit`, stamps authorship, applies the writes in memory, runs
 * `fixups` and turns the repairs into the server's own writes, then writes the rows, the log, the task clients, the
 * people row, the `access` table, and the push plan.
 */

export type Write = RowWrite & { opId?: string };
/** A write with the space it names: a `put` carries its `user_id`; a `patch` or `delete` learns it from the row. */
export type OwnedWrite = Write & { owner: string | null };
export type Rejected = { table: string; id: string; reason: string };
export type WriteContext = { actor: Actor; client: Client; now: number };
/** What was refused, and each touched space as it stands after the writes and repairs. */
export type Applied = { rejected: Rejected[]; spaces: Map<string, Snapshot> };

/** The tables whose rows are keyed by `(user_id, id)`; the rest by `id` alone. */
const PER_USER: ReadonlySet<Kind> = new Set<Kind>(['read', 'settings']);

type Keyed = { table: PgTable; columns: Record<string, PgColumn>; key: PgColumn[] };

function keyed(kind: Kind): Keyed {
	const table: PgTable = ENTITY_TABLES[kind];
	const columns = getTableColumns(table) as Record<string, PgColumn>;
	return { table, columns, key: PER_USER.has(kind) ? [columns.userId!, columns.id!] : [columns.id!] };
}

const rowKey = (write: Pick<RowWrite, 'kind' | 'id'>) => `${write.kind}:${write.id}`;
const reject = (write: Pick<RowWrite, 'kind' | 'id'>, reason: string): Rejected => ({
	table: TABLE_OF[write.kind],
	id: write.id,
	reason,
});

/** Who owns each stored row a patch or delete names, one query per table. Per-user rows are the actor's or nobody's. */
async function storedOwners(db: Db, actor: string, writes: readonly OwnedWrite[]): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	const byKind = Map.groupBy(
		writes.filter(write => write.op !== 'put'),
		write => write.kind,
	);
	await Promise.all(
		[...byKind].map(async ([kind, group]) => {
			const { table, columns } = keyed(kind);
			const ids = [...new Set(group.map(write => write.id))];
			const where = PER_USER.has(kind)
				? and(eq(columns.userId!, actor), inArray(columns.id!, ids))
				: inArray(columns.id!, ids);
			const rows = await db.select({ id: columns.id!, userId: columns.userId! }).from(table).where(where);
			for (const row of rows) found.set(`${kind}:${row.id}`, row.userId as string);
		}),
	);
	return found;
}

type TaskFields = Partial<FieldsByKind['task']>;
type CommentFields = Partial<FieldsByKind['comment']>;

/**
 * The server's authorship stamps, which overwrite whatever a client sent. A task's `createdBy` is set when it first
 * appears and kept after; `completedBy` follows `completedAt`, a recurring roll included through `lastCompletedAt`,
 * and clears when the task reopens. A comment's `authorId` is whoever sent it, and only the author changes it after.
 */
function stamp(snapshot: Snapshot, write: Write, actor: string): { write: Write } | { rejected: Rejected } {
	if (write.op === 'delete') {
		if (write.kind !== 'comment') return { write };
		const existing = snapshot.comments.find(comment => comment.id === write.id);
		return existing && existing.authorId !== actor
			? { rejected: reject(write, 'Only the author can delete a comment') }
			: { write };
	}
	if (write.kind === 'task') {
		const { createdBy: _, completedBy: __, ...fields } = write.values as TaskFields;
		const prev = snapshot.tasks.find(task => task.id === write.id);
		const values: TaskFields = { ...fields };
		if (!prev) values.createdBy = actor;
		else if (write.op === 'put') values.createdBy = prev.createdBy ?? null;
		const completedChanged =
			fields.completedAt !== undefined && !sameValue(prev?.completedAt ?? null, fields.completedAt);
		const rolled =
			fields.lastCompletedAt !== undefined && !sameValue(prev?.lastCompletedAt ?? null, fields.lastCompletedAt);
		if (completedChanged) values.completedBy = fields.completedAt === null ? null : actor;
		else if (rolled) values.completedBy = actor;
		else if (write.op === 'put') values.completedBy = prev?.completedBy ?? null;
		return { write: { ...write, values: values as Fields } };
	}
	if (write.kind === 'comment') {
		const { authorId: _, taskId, createdAt, ...fields } = write.values as CommentFields;
		const prev = snapshot.comments.find(comment => comment.id === write.id);
		if (!prev) {
			if (write.op === 'patch') return { write };
			return { write: { ...write, values: { ...fields, taskId, createdAt, authorId: actor } as Fields } };
		}
		if (prev.authorId !== actor) return { rejected: reject(write, 'Only the author can edit a comment') };
		const values: CommentFields =
			write.op === 'put' ? { ...fields, taskId: prev.taskId, createdAt: prev.createdAt, authorId: actor } : fields;
		return { write: { ...write, values: values as Fields } };
	}
	return { write };
}

type Outcome = { admitted: Write[]; repairs: RowWrite[]; rejected: Rejected[]; fixed: Snapshot };

/** The pure half: which writes land in the space, what the server repairs after them, and the snapshot that results. */
export function planSpace(space: Space, actor: Actor, writes: readonly Write[]): Outcome {
	const access = accessOf(space, actor);
	if (!access) {
		return {
			admitted: [],
			repairs: [],
			fixed: space.snapshot,
			rejected: writes.map(w => reject(w, 'Not shared with you')),
		};
	}
	const rejected: Rejected[] = [];
	let candidates: Write[] = [...writes];
	if (access.role === 'guest') {
		const opIds = new Map(writes.map(write => [rowKey(write), write.opId]));
		const { admitted, refused } = admit(space.snapshot, access.shares, writes, actor.id);
		rejected.push(...refused.map(write => reject(write, 'Not editable in this share')));
		candidates = admitted.map(write => ({ ...write, opId: opIds.get(rowKey(write)) }));
	}
	const admitted: Write[] = [];
	let after = space.snapshot;
	for (const candidate of candidates) {
		const result = stamp(after, candidate, actor.id);
		if ('rejected' in result) {
			rejected.push(result.rejected);
			continue;
		}
		admitted.push(result.write);
		after = applyWrite(after, result.write);
	}
	const fixed = fixups(after);
	return { admitted, repairs: rowWrites(after, fixed), rejected, fixed };
}

/** Writes rows for one space, batched: one upsert per table for the puts, one delete per table, a patch per row. */
async function writeRows(db: Db, owner: string, writes: readonly RowWrite[]): Promise<void> {
	const byKind = Map.groupBy(coalesce(writes), write => write.kind);
	for (const kind of KINDS) {
		const group = byKind.get(kind);
		if (!group) continue;
		const { table, columns, key } = keyed(kind);
		const own = eq(columns.userId!, owner);
		const puts = group.filter(write => write.op === 'put');
		if (puts.length) {
			const names = new Set(puts.flatMap(write => Object.keys(write.values ?? {})));
			const set = Object.fromEntries(
				[...names]
					.filter(name => columns[name])
					.map(name => [name, sql`excluded.${sql.identifier(columns[name]!.name)}`]),
			);
			await db
				.insert(table)
				.values(puts.map(write => ({ id: write.id, userId: owner, ...write.values })))
				.onConflictDoUpdate({ target: key, set });
		}
		for (const write of group) {
			if (write.op !== 'patch' || !Object.keys(write.values ?? {}).length) continue;
			await db
				.update(table)
				.set(write.values!)
				.where(and(own, eq(columns.id!, write.id)));
		}
		const deleted = group.filter(write => write.op === 'delete').map(write => write.id);
		if (deleted.length) await db.delete(table).where(and(own, inArray(columns.id!, deleted)));
	}
}

const logRow = (owner: string, write: Write, actor: string, at: number): typeof log.$inferInsert => ({
	userId: owner,
	opId: write.opId ?? null,
	kind: write.kind,
	id: write.id,
	op: write.op,
	fields: write.values ?? {},
	actor,
	at,
});

/**
 * A task's first write names its `created` app and every write its `edited` one. The row is written in one upsert
 * that only ever replaces `edited`, so a task's creator app is never overwritten. Fixups are the server's and are
 * not recorded.
 */
async function recordClients(db: Db, owner: string, before: Snapshot, writes: readonly Write[], stamp: ClientStamp) {
	const ids = [...new Set(writes.filter(write => write.kind === 'task').map(write => write.id))];
	if (!ids.length) return;
	const existed = new Set(before.tasks.map(task => task.id));
	await db
		.insert(taskClients)
		.values(ids.map(id => ({ userId: owner, id, created: existed.has(id) ? null : stamp, edited: stamp })))
		.onConflictDoUpdate({ target: [taskClients.userId, taskClients.id], set: { edited: sql`excluded.edited` } });
}

/** Everyone who acted in a space is remembered there, so activity and share lists can name them. */
export async function rememberPerson(db: Db, owner: string, actor: Actor, now: number): Promise<void> {
	await db
		.insert(people)
		.values({ userId: owner, id: actor.id, name: actor.name, kind: actor.kind, ownerId: actor.ownerId, seenAt: now })
		.onConflictDoUpdate({
			target: [people.userId, people.id],
			set: { name: actor.name, kind: actor.kind, ownerId: actor.ownerId, seenAt: now },
		});
}

/** Everything that follows a space's writes: the rows, the log, the clients, the person, `access`, and push. */
async function commitSpace(db: Db, space: Space, ctx: WriteContext, outcome: Outcome): Promise<void> {
	const { admitted, repairs, fixed } = outcome;
	const { actor, client, now } = ctx;
	await writeRows(db, space.owner, admitted);
	await writeRows(db, space.owner, repairs);
	await db
		.insert(log)
		.values([
			...admitted.map(write => logRow(space.owner, write, actor.id, now)),
			...repairs.map(write => logRow(space.owner, write, SERVER_ACTOR, now)),
		]);
	await recordClients(db, space.owner, space.snapshot, admitted, { ...client, at: now });
	await rememberPerson(db, space.owner, actor, now);
	await syncAccess(db, { ...space, snapshot: fixed });
	await replan(db, space.owner, fixed, now);
	await sweepImages(db, space.owner, fixed, now);
}

/**
 * One space's writes from the agent API, which decides them from the space it locks: `make` sees the loaded space
 * and the transaction, and answers the writes, or throws to apply nothing. Returns what was refused and the space as
 * it stands after. Reads inside `make` must use the transaction: PGlite has one connection, and a query on another
 * waits for the transaction forever.
 */
export async function transact(
	db: Db,
	owner: string,
	ctx: WriteContext,
	make: (space: Space, tx: Db) => Write[] | Promise<Write[]>,
): Promise<{ space: Space; rejected: Rejected[]; fixed: Snapshot }> {
	return db.transaction(async tx => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${owner}))`);
		const space = await loadSpace(tx, owner);
		const outcome = planSpace(space, ctx.actor, await make(space, tx));
		if (outcome.admitted.length) await commitSpace(tx, space, ctx, outcome);
		return { space, rejected: outcome.rejected, fixed: outcome.fixed };
	});
}

/**
 * Applies the actor's writes to the spaces they name. A patch or delete of a row that no longer exists changes
 * nothing, which is how a delete beats an edit that arrives after it. Each space is locked for the transaction, so
 * two uploads to one space apply one after the other and both see the repairs the other made.
 */
export async function applyWrites(db: Db, ctx: WriteContext, writes: readonly OwnedWrite[]): Promise<Applied> {
	const rejected: Rejected[] = [];
	const spaces = new Map<string, Snapshot>();
	// Folded first, so a put and the patches that follow it in one batch land as one row, not a put and no-ops.
	const folded = coalesce(writes);
	await db.transaction(async tx => {
		const stored = await storedOwners(tx, ctx.actor.id, folded);
		const bySpace = new Map<string, Write[]>();
		for (const write of folded) {
			const owner = write.op === 'put' ? write.owner : stored.get(rowKey(write));
			if (owner === undefined || owner === null) continue;
			const { owner: _, ...rest } = write;
			bySpace.set(owner, [...(bySpace.get(owner) ?? []), rest]);
		}
		for (const [owner, group] of bySpace) {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${owner}))`);
			const space = await loadSpace(tx, owner);
			const outcome = planSpace(space, ctx.actor, group);
			rejected.push(...outcome.rejected);
			if (outcome.admitted.length) await commitSpace(tx, space, ctx, outcome);
			spaces.set(owner, outcome.fixed);
		}
	});
	return { rejected, spaces };
}
