import { and, eq, inArray, sql } from 'drizzle-orm';
import { access, type AccessRow } from '../../shared/db/schema';
import { user } from './db/auth-schema';
import type { Snapshot } from '../../shared/model';
import { managesSpace, scopeOf, type Grant } from '../../shared/scope';
import type { Db } from './db/postgres';
import type { Space } from './space';

/**
 * The `access` table: one row per entity a human grantee may see in another user's space, which PowerSync's
 * `shared` stream reads. Recomputed from the owner's shares with `scopeOf` after every write to a shared space and
 * after every share change. AI accounts never sync, so they get no rows.
 */

const rowId = (grantee: string, kind: AccessRow['kind'], entityId: string) => `${grantee}:${kind}:${entityId}`;

export function accessRows(owner: string, grantee: string, snapshot: Snapshot, grants: readonly Grant[]): AccessRow[] {
	const scope = scopeOf(snapshot, grants);
	const manager = managesSpace(grants);
	const rows: AccessRow[] = [];
	const add = (kind: AccessRow['kind'], entityId: string, role: AccessRow['role']) =>
		rows.push({ id: rowId(grantee, kind, entityId), grantee, owner, kind, entityId, role });
	for (const id of scope.tasks) add('task', id, scope.editable.has(id) ? 'edit' : 'view');
	for (const id of scope.projects) add('project', id, manager ? 'edit' : 'view');
	for (const id of scope.sections) add('section', id, manager ? 'edit' : 'view');
	for (const id of scope.labels) add('label', id, manager ? 'edit' : 'view');
	return rows;
}

/** Link shares have no grantee, and AI accounts read through the API. */
async function humanGrantees(db: Db, space: Space): Promise<string[]> {
	const ids = [...new Set(space.shares.map(share => share.grantee).filter((id): id is string => id !== null))];
	if (!ids.length) return [];
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(and(inArray(user.id, ids), eq(user.kind, 'human')));
	return rows.map(row => row.id);
}

/** A space nobody human is shared with has no rows and costs one query. */
export async function syncAccess(db: Db, space: Space): Promise<void> {
	const grantees = await humanGrantees(db, space);
	const wanted = new Map<string, AccessRow>();
	for (const grantee of grantees) {
		const grants = space.shares.filter(share => share.grantee === grantee);
		for (const row of accessRows(space.owner, grantee, space.snapshot, grants)) wanted.set(row.id, row);
	}
	const existing = await db.select().from(access).where(eq(access.owner, space.owner));
	const stale = existing.filter(row => !wanted.has(row.id)).map(row => row.id);
	const changed = [...wanted.values()].filter(row => {
		const current = existing.find(candidate => candidate.id === row.id);
		return !current || current.role !== row.role;
	});
	if (stale.length) await db.delete(access).where(inArray(access.id, stale));
	if (changed.length) {
		await db
			.insert(access)
			.values(changed)
			.onConflictDoUpdate({ target: access.id, set: { role: sql`excluded.role` } });
	}
}
