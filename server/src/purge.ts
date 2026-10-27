import { and, eq, not, or, sql } from 'drizzle-orm';
import type { ServerWriter } from 'sync-engine/core';
import { comments, ENTITY_TABLES, labels, log, projects, sections, tasks } from '../../shared/db/schema';
import { KINDS } from '../../shared/kinds';
import type { Db } from './db/sqlite';

/**
 * Delete all data uploads one delete per row, and the log would keep every deleted row's fields and apps for good. So
 * when the owner's own delete leaves their space with no task, project, section, or label, the space's log rows for
 * every row that is gone go too. It runs in the transaction of the writes that emptied the space, after their log
 * rows, so a delete all that lands over several syncs is purged by whichever empties the space, and a later one that
 * deletes comments or reads purges again. A row created meanwhile keeps its history.
 * A comment outlives its task for undo, but in an empty space every comment's task is gone, so those comments go
 * first, through the engine so every device drops them: a guest's would otherwise stay, since only its author may
 * delete it, and keep syncing to the owner. Other spaces' log rows, the actor's writes there included, are never
 * touched.
 */
export function purgeIfEmptied(db: Db, owner: string, server: ServerWriter): void {
	const held = [tasks, projects, sections, labels].some(
		table => db.select({ id: table.id }).from(table).where(eq(table.userId, owner)).limit(1).get() !== undefined,
	);
	if (held) return;
	const orphans = db
		.select({ id: comments.id })
		.from(comments)
		.where(
			and(eq(comments.userId, owner), sql`not exists (select 1 from ${tasks} where ${tasks.id} = ${comments.taskId})`),
		)
		.all();
	for (const { id } of orphans) server.delete('comments', id);
	const stored = KINDS.map(kind => {
		const table = ENTITY_TABLES[kind];
		return sql`(${log.kind} = ${kind} and exists (select 1 from ${table} where ${table.id} = ${log.id} and ${table.userId} = ${log.userId}))`;
	});
	db.delete(log)
		.where(and(eq(log.userId, owner), not(or(...stored)!)))
		.run();
}
