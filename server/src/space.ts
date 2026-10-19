import { and, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Actor } from '../../shared/auth';
import { resolveDangling, type Entities, type Links } from '../../shared/dangling';
import {
	access as accessTable,
	labels,
	projects,
	sections,
	settings,
	shares,
	tasks,
	type AccessRow,
} from '../../shared/db/schema';
import { SETTINGS_ID } from '../../shared/model';
import { managesSpace, type Scope } from '../../shared/scope';
import { byCreation } from '../../shared/snapshot';
import { isTimeZone } from '../../shared/zoned-time';
import type { ShareRow } from '../../shared/db/schema';
import type { Db } from './db/postgres';

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

/** The rows a scope names, resolved like `loadTree`: four selects by id, which postgres.js pipelines. */
export async function loadScope(db: Db, owner: string, scope: Scope): Promise<Entities> {
	const ids = (set: ReadonlySet<string>) => [...set];
	const [taskRows, projectRows, sectionRows, labelRows] = await Promise.all([
		scope.tasks.size
			? db
					.select()
					.from(tasks)
					.where(and(eq(tasks.userId, owner), inArray(tasks.id, ids(scope.tasks))))
			: [],
		scope.projects.size
			? db
					.select()
					.from(projects)
					.where(and(eq(projects.userId, owner), inArray(projects.id, ids(scope.projects))))
			: [],
		scope.sections.size
			? db
					.select()
					.from(sections)
					.where(and(eq(sections.userId, owner), inArray(sections.id, ids(scope.sections))))
			: [],
		scope.labels.size
			? db
					.select()
					.from(labels)
					.where(and(eq(labels.userId, owner), inArray(labels.id, ids(scope.labels))))
			: [],
	]);
	return resolveDangling({
		tasks: (taskRows.map(entity) as Entities['tasks']).toSorted(byCreation),
		projects: (projectRows.map(entity) as Entities['projects']).toSorted(byCreation),
		sections: (sectionRows.map(entity) as Entities['sections']).toSorted(byCreation),
		labels: (labelRows.map(entity) as Entities['labels']).toSorted(byCreation),
	});
}

/** The links between the space's rows, which is all `scopeOf` reads, resolved like `loadTree`: a few columns each. */
export async function loadLinks(db: Db, owner: string): Promise<Links> {
	const [taskRows, projectRows, sectionRows, labelRows] = await Promise.all([
		db
			.select({
				id: tasks.id,
				parentId: tasks.parentId,
				projectId: tasks.projectId,
				sectionId: tasks.sectionId,
				labelIds: tasks.labelIds,
			})
			.from(tasks)
			.where(eq(tasks.userId, owner)),
		db.select({ id: projects.id }).from(projects).where(eq(projects.userId, owner)),
		db.select({ id: sections.id, projectId: sections.projectId }).from(sections).where(eq(sections.userId, owner)),
		db.select({ id: labels.id }).from(labels).where(eq(labels.userId, owner)),
	]);
	return resolveDangling({ tasks: taskRows, projects: projectRows, sections: sectionRows, labels: labelRows });
}

/** The owner's time zone, or UTC while none is set or the setting names no zone, since any device can write it. */
export async function storedZone(db: Db, owner: string): Promise<string> {
	const [row] = await db
		.select({ timeZone: settings.timeZone })
		.from(settings)
		.where(and(eq(settings.userId, owner), eq(settings.id, SETTINGS_ID)));
	return row?.timeZone && isTimeZone(row.timeZone) ? row.timeZone : 'UTC';
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

export type Access = { role: 'owner' } | { role: 'guest'; shares: ShareRow[] };

/** What a caller sees: everything (the owner, or a manager of the whole space), or what its `access` rows name. */
export type Sight = { kind: 'all' } | { kind: 'rows'; grantee: string };

export function sightOf(actor: Actor, access: Access): Sight {
	if (access.role === 'owner' || managesSpace(access.shares)) return { kind: 'all' };
	return { kind: 'rows', grantee: actor.id };
}

/** A condition on an id column of `owner`'s space, of rows of `kind`, that holds for the rows `sight` sees. */
export function seenBy(
	db: Db,
	sight: Sight,
	owner: string,
	id: PgColumn,
	kind: AccessRow['kind'] = 'task',
): SQL | undefined {
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
							eq(accessTable.kind, kind),
							eq(accessTable.entityId, id),
						),
					),
			);
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
