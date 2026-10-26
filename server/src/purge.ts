import { and, eq, not, or, sql } from 'drizzle-orm';
import { comments, ENTITY_TABLES, labels, log, projects, sections, tasks } from '../../shared/db/schema';
import { KINDS } from '../../shared/kinds';
import type { Db } from './db/postgres';

/**
 * Delete all data uploads one delete per row, and the log would keep every deleted row's fields and apps for good. So
 * when the owner's own delete leaves their space with no task, project, section, or label, the space's log rows for
 * every row that is gone go too. It runs after the batch's log insert, so a delete all that lands over several
 * batches is purged by whichever empties the space, and a later one that deletes comments or reads purges again.
 * Every check reads the rows as they are, so it converges when rerun, and a row created meanwhile keeps its history.
 * A comment outlives its task for undo, but in an empty space every comment's task is gone, so those comments go
 * first: a guest's would otherwise stay, since only its author may delete it, and keep syncing to the owner. The
 * delete checks each task again, so a task an undo restores after the probe keeps its comments.
 * Other spaces' log rows, the actor's writes there included, are never touched.
 */
export async function purgeIfEmptied(db: Db, owner: string): Promise<void> {
	const [held] = await db
		.select({ id: tasks.id })
		.from(tasks)
		.where(eq(tasks.userId, owner))
		.unionAll(db.select({ id: projects.id }).from(projects).where(eq(projects.userId, owner)))
		.unionAll(db.select({ id: sections.id }).from(sections).where(eq(sections.userId, owner)))
		.unionAll(db.select({ id: labels.id }).from(labels).where(eq(labels.userId, owner)))
		.limit(1);
	if (held) return;
	await db
		.delete(comments)
		.where(
			and(eq(comments.userId, owner), sql`not exists (select 1 from ${tasks} where ${tasks.id} = ${comments.taskId})`),
		);
	const stored = KINDS.map(kind => {
		const table = ENTITY_TABLES[kind];
		return sql`(${log.kind} = ${kind} and exists (select 1 from ${table} where ${table.id} = ${log.id} and ${table.userId} = ${log.userId}))`;
	});
	await db.delete(log).where(and(eq(log.userId, owner), not(or(...stored)!)));
}
