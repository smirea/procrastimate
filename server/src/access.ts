import { and, eq, isNotNull, not } from 'drizzle-orm';
import type { ServerWriter } from 'sync-engine/core';
import { access, shares, type AccessRow } from '../../shared/db/schema';
import { toWire } from '../../shared/db/wire';
import type { Links } from '../../shared/dangling';
import type { RowWrite } from '../../shared/rows';
import { managesSpace, scopeOf, type Grant } from '../../shared/scope';
import type { Db } from './db/sqlite';
import { loadLinks } from './space';

/**
 * The `access` table: one row per entity a grantee, a person or an AI account alike, may see in another user's space.
 * Every read and write of a grantee checks it, and the sync view reads it to filter each grantee's pulls. The rows
 * sync to their grantee, so they change only through the engine's `ServerWriter`.
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
 * a recompute after a write names none and rewrites every grantee's. The tree is read only when a grantee needs rows.
 */
export function syncAccess(db: Db, server: ServerWriter, owner: string, grantee?: string): void {
	const shared = db
		.select({ grantee: shares.grantee, targetKind: shares.targetKind, targetId: shares.targetId, role: shares.role })
		.from(shares)
		.where(
			and(
				eq(shares.userId, owner),
				isNotNull(shares.grantee),
				grantee === undefined ? undefined : eq(shares.grantee, grantee),
			),
		)
		.all();
	const existing = db
		.select()
		.from(access)
		.where(and(eq(access.owner, owner), grantee === undefined ? undefined : eq(access.grantee, grantee)))
		.all();
	const granted = [...Map.groupBy(shared, share => share.grantee!)].filter(([, grants]) => !managesSpace(grants));
	const wanted = new Map<string, AccessRow>();
	if (granted.length) {
		const tree = loadLinks(db, owner);
		for (const [id, grants] of granted) {
			for (const row of accessRows(owner, id, tree, grants)) wanted.set(row.id, row);
		}
	}
	const roles = new Map(existing.map(row => [row.id, row.role]));
	for (const row of existing) if (!wanted.has(row.id)) server.delete('access', row.id);
	for (const row of wanted.values()) {
		if (roles.get(row.id) === row.role) continue;
		const { id, ...values } = row;
		server.put('access', id, toWire(access, values));
	}
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
 * Recomputes a space's rows after a write. The common case, a space shared with nobody but managers, costs one query
 * and stops.
 */
export function recomputeAccess(db: Db, owner: string, server: ServerWriter): void {
	const shared = db
		.select({ id: shares.id })
		.from(shares)
		.where(
			and(
				eq(shares.userId, owner),
				isNotNull(shares.grantee),
				not(and(eq(shares.targetKind, 'space'), eq(shares.role, 'edit'))!),
			),
		)
		.limit(1)
		.get();
	if (shared) syncAccess(db, server, owner);
}
