import { and, eq, inArray, sql } from 'drizzle-orm';
import { access, shares, type AccessRow } from '../../shared/db/schema';
import { user } from './db/auth-schema';
import type { Entities } from '../../shared/dangling';
import type { RowWrite } from '../../shared/rows';
import { managesSpace, scopeOf, type Grant, type GuestRows } from '../../shared/scope';
import type { Db } from './db/postgres';
import { loadTree, withSpaceLocked } from './space';

/**
 * The `access` table: one row per entity a human grantee may see in another user's space, which PowerSync's
 * `shared` stream reads and `guestRefusal` checks a guest's writes against. Recomputed from the owner's shares with
 * `scopeOf` after every share change, and after an upload only when a write moved what a guest may see in a space
 * that has human grantees. AI accounts never sync, so they get no rows.
 */

const rowId = (grantee: string, kind: AccessRow['kind'], entityId: string) => `${grantee}:${kind}:${entityId}`;

/**
 * A task's role is whether the grantee may edit it. A project's, section's, or label's is whether a new task of theirs
 * may land there, which `guestRefusal` allows only through an edit share on it or on the whole space, so clients
 * decide `canAddTo` from the row alone.
 */
export function accessRows(owner: string, grantee: string, snapshot: Entities, grants: readonly Grant[]): AccessRow[] {
	const scope = scopeOf(snapshot, grants);
	const manager = managesSpace(grants);
	const addsTo = (kind: 'project' | 'label', id: string): AccessRow['role'] =>
		manager || grants.some(grant => grant.targetKind === kind && grant.targetId === id && grant.role === 'edit')
			? 'edit'
			: 'view';
	const rows: AccessRow[] = [];
	const add = (kind: AccessRow['kind'], entityId: string, role: AccessRow['role']) =>
		rows.push({ id: rowId(grantee, kind, entityId), grantee, owner, kind, entityId, role });
	for (const id of scope.tasks) add('task', id, scope.editable.has(id) ? 'edit' : 'view');
	for (const id of scope.projects) add('project', id, addsTo('project', id));
	for (const section of snapshot.sections) {
		if (scope.sections.has(section.id)) add('section', section.id, addsTo('project', section.projectId));
	}
	for (const id of scope.labels) add('label', id, addsTo('label', id));
	return rows;
}

/**
 * Rewrites the space's `access` rows from its shares to humans: link shares have no grantee, and AI accounts read
 * through the API. The tree is read only when someone human is shared with. Callers hold the space's lock.
 */
export async function syncAccess(db: Db, owner: string): Promise<void> {
	const [granted, existing] = await Promise.all([
		db
			.select({ grantee: shares.grantee, targetKind: shares.targetKind, targetId: shares.targetId, role: shares.role })
			.from(shares)
			.innerJoin(user, eq(user.id, shares.grantee))
			.where(and(eq(shares.userId, owner), eq(user.kind, 'human'))),
		db.select().from(access).where(eq(access.owner, owner)),
	]);
	const wanted = new Map<string, AccessRow>();
	if (granted.length) {
		const tree = await loadTree(db, owner);
		for (const [grantee, grants] of Map.groupBy(granted, share => share.grantee!)) {
			for (const row of accessRows(owner, grantee, tree, grants)) wanted.set(row.id, row);
		}
	}
	const roles = new Map(existing.map(row => [row.id, row.role]));
	const stale = existing.filter(row => !wanted.has(row.id)).map(row => row.id);
	const changed = [...wanted.values()].filter(row => roles.get(row.id) !== row.role);
	if (stale.length) await db.delete(access).where(inArray(access.id, stale));
	if (changed.length) {
		await db
			.insert(access)
			.values(changed)
			.onConflictDoUpdate({ target: access.id, set: { role: sql`excluded.role` } });
	}
}

/** One guest's rows in one space: what `guestRefusal` reads. */
export function guestRows(db: Db, grantee: string, owner: string): Promise<GuestRows> {
	return db
		.select({ kind: access.kind, entityId: access.entityId, role: access.role })
		.from(access)
		.where(and(eq(access.grantee, grantee), eq(access.owner, owner)));
}

const SCOPE_FIELDS = ['parentId', 'projectId', 'sectionId', 'labelIds'];

/** Whether a write can move what a guest sees: a task created, deleted, or moved, or a section created, moved, or deleted. */
export function touchesAccess(write: RowWrite): boolean {
	const fields = write.values ?? {};
	if (write.kind === 'section') return write.op !== 'patch' || 'projectId' in fields;
	if (write.kind !== 'task') return false;
	return write.op !== 'patch' || SCOPE_FIELDS.some(field => field in fields);
}

/**
 * Recomputes a space's rows after an upload. The common case, a space with no human grantee, costs one query and
 * stops. The rest runs under the space's advisory lock, the same one the share routes take, so a share change and a
 * recompute never read shares the other is changing.
 */
export async function recomputeAccess(db: Db, owner: string): Promise<void> {
	const [shared] = await db
		.select({ id: shares.id })
		.from(shares)
		.innerJoin(user, eq(user.id, shares.grantee))
		.where(and(eq(shares.userId, owner), eq(user.kind, 'human')))
		.limit(1);
	if (!shared) return;
	await withSpaceLocked(db, owner, tx => syncAccess(tx, owner));
}
