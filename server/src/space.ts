import { and, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Actor } from '../../shared/auth';
import { resolveDangling, type Entities } from '../../shared/dangling';
import { access as accessTable, labels, projects, sections, settings, shares, tasks } from '../../shared/db/schema';
import { SETTINGS_ID } from '../../shared/model';
import { scopeOf } from '../../shared/scope';
import { byCreation } from '../../shared/snapshot';
import type { Access } from './auth';
import type { Db } from './db/postgres';

/**
 * Reads of one user's space, each sized to what its caller needs: the tree of tasks, projects, sections, and labels
 * that scopes and views are computed from, the caller's standing, and which tasks the caller sees.
 */

/** A row without its owner column, and without a `null` `sourceKey`, which the entity schemas leave out. */
export function entity<T extends { userId: string }>(row: T): Omit<T, 'userId'> {
	const { userId: _, ...rest } = row;
	if ('sourceKey' in rest && rest.sourceKey === null) delete (rest as { sourceKey?: unknown }).sourceKey;
	return rest;
}

/**
 * The space's tasks, projects, sections, and labels with dangling references resolved the way clients read them, in
 * creation order. Four parallel selects, which postgres.js pipelines on one connection.
 */
export async function loadTree(db: Db, owner: string): Promise<Entities> {
	const [taskRows, projectRows, sectionRows, labelRows] = await Promise.all([
		db.select().from(tasks).where(eq(tasks.userId, owner)),
		db.select().from(projects).where(eq(projects.userId, owner)),
		db.select().from(sections).where(eq(sections.userId, owner)),
		db.select().from(labels).where(eq(labels.userId, owner)),
	]);
	return resolveDangling({
		tasks: (taskRows.map(entity) as Entities['tasks']).toSorted(byCreation),
		projects: (projectRows.map(entity) as Entities['projects']).toSorted(byCreation),
		sections: (sectionRows.map(entity) as Entities['sections']).toSorted(byCreation),
		labels: (labelRows.map(entity) as Entities['labels']).toSorted(byCreation),
	});
}

export async function storedTimeZone(db: Db, owner: string): Promise<string | null> {
	const [row] = await db
		.select({ timeZone: settings.timeZone })
		.from(settings)
		.where(and(eq(settings.userId, owner), eq(settings.id, SETTINGS_ID)));
	return row?.timeZone ?? null;
}

/**
 * Runs `use` in a transaction that holds the space's advisory lock. Share changes and the `access` recompute after an
 * upload take it, so a recompute never reads shares a share change is still writing.
 */
export function withSpaceLocked<T>(db: Db, owner: string, use: (tx: Db) => Promise<T>): Promise<T> {
	return db.transaction(async tx => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${owner}))`);
		return use(tx);
	});
}

/**
 * The owner, or a guest with the space's shares to them, which is the one query a guest costs. Anyone else is turned
 * away. An AI account has no space of its own; owning one would hand each token an empty writable partition.
 */
export async function accessIn(db: Db, owner: string, actor: Actor): Promise<Access | null> {
	if (actor.id === owner) return actor.kind === 'human' ? { role: 'owner' } : null;
	const granted = await db
		.select()
		.from(shares)
		.where(and(eq(shares.userId, owner), eq(shares.grantee, actor.id)));
	return granted.length ? { role: 'guest', shares: granted.map(entity) } : null;
}

/**
 * Which of the space's tasks the caller sees. The owner and a whole-space grant see every one. A human guest sees what
 * its `access` rows name, which the server keeps equal to `scopeOf`. An AI account has no `access` rows, so one with
 * narrower grants gets its scope worked out from the tree.
 */
export type Sight = { kind: 'all' } | { kind: 'rows'; grantee: string } | { kind: 'tasks'; ids: ReadonlySet<string> };

export async function sightOf(db: Db, owner: string, actor: Actor, access: Access): Promise<Sight> {
	if (access.role === 'owner' || access.shares.some(share => share.targetKind === 'space')) return { kind: 'all' };
	if (actor.kind === 'human') return { kind: 'rows', grantee: actor.id };
	return { kind: 'tasks', ids: scopeOf(await loadTree(db, owner), access.shares).tasks };
}

/** A condition on a task id column of `owner`'s space that holds for the tasks `sight` sees. */
export function seenBy(db: Db, sight: Sight, owner: string, taskId: PgColumn): SQL | undefined {
	switch (sight.kind) {
		case 'all':
			return undefined;
		case 'rows':
			return exists(
				db
					.select({ one: sql`1` })
					.from(accessTable)
					.where(
						and(
							eq(accessTable.grantee, sight.grantee),
							eq(accessTable.owner, owner),
							eq(accessTable.kind, 'task'),
							eq(accessTable.entityId, taskId),
						),
					),
			);
		case 'tasks':
			return inArray(taskId, [...sight.ids]);
	}
}

/** Whether the caller sees task `id`: one select. */
export async function seesTask(db: Db, owner: string, sight: Sight, id: string): Promise<boolean> {
	const [row] = await db
		.select({ id: tasks.id })
		.from(tasks)
		.where(and(eq(tasks.userId, owner), eq(tasks.id, id), seenBy(db, sight, owner, tasks.id)));
	return row !== undefined;
}
