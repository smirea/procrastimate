import { and, eq, inArray, isNotNull, not, sql } from 'drizzle-orm';
import { access, shares, type AccessRow } from '../../shared/db/schema';
import type { Links } from '../../shared/dangling';
import type { RowWrite } from '../../shared/rows';
import { managesSpace, scopeOf, type Grant, type GuestRows } from '../../shared/scope';
import type { Db } from './db/postgres';
import { loadLinks, withSpaceLocked } from './space';

/**
 * The `access` table: one row per entity a grantee, a person or an AI account alike, may see in another user's space.
 * Every read and write of a grantee checks it, and PowerSync's `shared` stream reads it for the people who sync.
 * Recomputed from the owner's shares with `scopeOf` after every share change, and after an upload only when a write
 * moved what a grantee may see. A manager of the whole space sees everything and needs none, and links have no grantee.
 */

const rowId = (grantee: string, kind: AccessRow['kind'], entityId: string) => `${grantee}:${kind}:${entityId}`;

/**
 * A task's role is whether the grantee may edit it. A project's, section's, or label's is whether a new task of theirs
 * may land there, which `guestRefusal` allows only through an edit share on it or on the whole space, so clients
 * decide `canAddTo` from the row alone.
 */
export function accessRows(owner: string, grantee: string, snapshot: Links, grants: readonly Grant[]): AccessRow[] {
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
 * Rewrites the space's `access` rows from its shares. A share change names its `grantee`, whose rows alone it can move;
 * a recompute after an upload names none and rewrites every grantee's. The tree is read only when a grantee needs rows.
 * Callers hold the space's lock.
 */
export async function syncAccess(db: Db, owner: string, grantee?: string): Promise<void> {
	const [shared, existing] = await Promise.all([
		db
			.select({ grantee: shares.grantee, targetKind: shares.targetKind, targetId: shares.targetId, role: shares.role })
			.from(shares)
			.where(
				and(
					eq(shares.userId, owner),
					isNotNull(shares.grantee),
					grantee === undefined ? undefined : eq(shares.grantee, grantee),
				),
			),
		db
			.select()
			.from(access)
			.where(and(eq(access.owner, owner), grantee === undefined ? undefined : eq(access.grantee, grantee))),
	]);
	const granted = [...Map.groupBy(shared, share => share.grantee!)].filter(([, grants]) => !managesSpace(grants));
	const wanted = new Map<string, AccessRow>();
	if (granted.length) {
		const tree = await loadLinks(db, owner);
		for (const [id, grants] of granted) {
			for (const row of accessRows(owner, id, tree, grants)) wanted.set(row.id, row);
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

/**
 * Runs a guest's writes in one space in a transaction that holds the space's advisory lock shared, then reads the
 * guest's rows there, which is what `guestRefusal` checks them against. Share changes and recomputes hold it exclusive
 * (`withSpaceLocked`), so a revoke or downgrade waits for the writes to commit, and writes that start after it see the
 * new rows: no write lands on a share that was already taken away. Guests' writes still run side by side, and a lock
 * on the space rather than on its rows cannot deadlock against a recompute rewriting them.
 */
export function asGuest<T>(
	db: Db,
	grantee: string,
	owner: string,
	use: (tx: Db, rows: GuestRows) => Promise<T>,
): Promise<T> {
	return db.transaction(async tx => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${owner}))`);
		const rows = await tx
			.select({ kind: access.kind, entityId: access.entityId, role: access.role })
			.from(access)
			.where(and(eq(access.grantee, grantee), eq(access.owner, owner)));
		return use(tx, rows);
	});
}

const SCOPE_FIELDS = ['parentId', 'projectId', 'sectionId', 'labelIds'];

/**
 * Whether a write can move what a guest sees: a task created, deleted, or moved, a section created, moved, or deleted,
 * or a project or label created or deleted, since a share reaches only live ones and a task in a deleted project or
 * with a deleted label reads without it.
 */
export function touchesAccess(write: RowWrite): boolean {
	const fields = write.values ?? {};
	switch (write.kind) {
		case 'task':
			return write.op !== 'patch' || SCOPE_FIELDS.some(field => field in fields);
		case 'section':
			return write.op !== 'patch' || 'projectId' in fields;
		case 'project':
		case 'label':
			return write.op !== 'patch';
		default:
			return false;
	}
}

/**
 * Recomputes a space's rows after an upload. The common case, a space shared with nobody but managers, costs one query
 * and stops. The rest runs under the space's advisory lock, the same one the share routes take, so a share change and a
 * recompute never read shares the other is changing.
 */
export async function recomputeAccess(db: Db, owner: string): Promise<void> {
	const [shared] = await db
		.select({ id: shares.id })
		.from(shares)
		.where(
			and(
				eq(shares.userId, owner),
				isNotNull(shares.grantee),
				not(and(eq(shares.targetKind, 'space'), eq(shares.role, 'edit'))!),
			),
		)
		.limit(1);
	if (!shared) return;
	await withSpaceLocked(db, owner, tx => syncAccess(tx, owner));
}
