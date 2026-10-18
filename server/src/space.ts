import { eq, sql } from 'drizzle-orm';
import type { Person } from '../../shared/sharing';
import {
	comments,
	labels,
	projects,
	reads,
	sections,
	settings,
	shares,
	tasks,
	type ShareRow,
} from '../../shared/db/schema';
import { DEFAULT_SETTINGS, SETTINGS_ID, type Snapshot } from '../../shared/model';
import { sortSnapshot } from '../../shared/snapshot';
import type { Access } from './auth';
import type { Db } from './db/postgres';

/**
 * One user's space as the store rules read it: every synced row the owner holds, plus the owner's shares. Loaded
 * with parallel selects, which postgres.js pipelines on one connection, so a space costs one round trip.
 */
export type Space = { owner: string; snapshot: Snapshot; shares: ShareRow[]; settingsStored: boolean };

/** A row without its owner column, and without a `null` `sourceKey`, which the entity schemas leave out. */
function entity<T extends { userId: string }>(row: T): Omit<T, 'userId'> {
	const { userId: _, ...rest } = row;
	if ('sourceKey' in rest && rest.sourceKey === null) delete (rest as { sourceKey?: unknown }).sourceKey;
	return rest;
}

export async function loadSpace(db: Db, owner: string): Promise<Space> {
	const [taskRows, projectRows, sectionRows, labelRows, commentRows, readRows, settingsRows, shareRows] =
		await Promise.all([
			db.select().from(tasks).where(eq(tasks.userId, owner)),
			db.select().from(projects).where(eq(projects.userId, owner)),
			db.select().from(sections).where(eq(sections.userId, owner)),
			db.select().from(labels).where(eq(labels.userId, owner)),
			db.select().from(comments).where(eq(comments.userId, owner)),
			db.select().from(reads).where(eq(reads.userId, owner)),
			db.select().from(settings).where(eq(settings.userId, owner)),
			db.select().from(shares).where(eq(shares.userId, owner)),
		]);
	const stored = settingsRows.find(row => row.id === SETTINGS_ID);
	const { userId: _, id: __, ...ownSettings } = stored ?? { userId: owner, id: SETTINGS_ID, ...DEFAULT_SETTINGS };
	const snapshot: Snapshot = sortSnapshot({
		tasks: taskRows.map(entity) as Snapshot['tasks'],
		projects: projectRows.map(entity) as Snapshot['projects'],
		sections: sectionRows.map(entity) as Snapshot['sections'],
		labels: labelRows.map(entity) as Snapshot['labels'],
		comments: commentRows.map(entity),
		reads: readRows.map(entity),
		settings: ownSettings,
	});
	return { owner, snapshot, shares: shareRows.map(entity), settingsStored: stored !== undefined };
}

/**
 * Runs `use` in a transaction that holds the space's advisory lock, with the space loaded under it. Every writer to a
 * space (uploads, agent commands, share changes) goes through here, so each sees the rows the last one left and the
 * `access` rows it recomputes are never from a stale read. Inside a transaction this is a savepoint.
 */
export function withSpaceLocked<T>(db: Db, owner: string, use: (tx: Db, space: Space) => Promise<T>): Promise<T> {
	return db.transaction(async tx => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${owner}))`);
		return use(tx, await loadSpace(tx, owner));
	});
}

/** The owner's shares to one grantee, which `scopeOf` and `admit` read. */
export const grantsFor = (space: Space, grantee: string): ShareRow[] =>
	space.shares.filter(share => share.grantee === grantee);

/**
 * The owner, or a guest with the space's shares to them. Anyone else is turned away. An AI account has no space of
 * its own; owning one would hand each token an empty writable partition.
 */
export function accessOf(space: Space, actor: Person): Access | null {
	if (actor.id === space.owner) return actor.kind === 'human' ? { role: 'owner' } : null;
	const granted = grantsFor(space, actor.id);
	return granted.length ? { role: 'guest', shares: granted } : null;
}
