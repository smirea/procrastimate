import { ORPCError } from '@orpc/server';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { apiTokens, people, shares, type ShareRow } from '../../shared/db/schema';
import { newId } from '../../shared/id';
import { filterSnapshot, scopeOf } from '../../shared/scope';
import type { ApiToken, CreatedApiToken, Person, ShareTarget, ShareView, SharedView } from '../../shared/sharing';
import type { Role } from '../../shared/values';
import { syncAccess } from './access';
import type { App } from './app';
import { sha256 } from './auth';
import { user } from './db/auth-schema';
import type { Db } from './db/postgres';
import { userById } from './better-auth';
import { personOf, requireManager } from './commands';
import { agentPrompt } from './docs';
import { loadSpace, withSpaceLocked, type Space } from './space';
import type { Access } from './auth';
import { rememberPerson } from './writes';

/**
 * Shares, public links, people, and API tokens, all rows in the owner's space. Every share change recomputes the
 * owner's `access` rows, which is what moves a guest's PowerSync view.
 */

/** The link token is `<ownerId>.<id>`, and the share's id is the secret. */
export const linkUrl = (origin: string, ownerId: string, id: string) => `${origin}/s/${ownerId}.${id}`;

function randomSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

async function shareView(db: Db, space: Space, origin: string, share: ShareRow): Promise<ShareView> {
	return {
		id: share.id,
		target: { kind: share.targetKind, id: share.targetId },
		grantee: share.grantee === null ? null : await personOf(db, space.owner, share.grantee),
		role: share.role,
		createdAt: share.createdAt,
		url: share.grantee === null ? linkUrl(origin, space.owner, share.id) : null,
	};
}

export const listShares = (db: Db, space: Space, origin: string) =>
	Promise.all(space.shares.map(share => shareView(db, space, origin, share)));

/** A target must be live in the space. The whole space has no id. */
function checkTarget({ snapshot }: Space, target: ShareTarget) {
	if (target.kind === 'space') return;
	const list =
		target.kind === 'project' ? snapshot.projects : target.kind === 'label' ? snapshot.labels : snapshot.tasks;
	if (!list.some(entity => entity.id === target.id)) throw new ORPCError('NOT_FOUND', { message: 'No such target' });
}

/**
 * Writes the share and remembers the grantee, under the space's lock so an upload in flight cannot recompute `access`
 * from the shares it read before. A link is always read only. Sharing the same target with the same audience again
 * keeps the row, so a link's URL stays stable and a user's role is simply updated.
 */
export function createShare(
	db: Db,
	owner: string,
	origin: string,
	target: ShareTarget,
	grantee: Person | null,
	role: Role,
	now: number,
): Promise<ShareView> {
	return withSpaceLocked(db, owner, async (tx, space) => {
		checkTarget(space, target);
		const existing = space.shares.find(
			s => s.targetKind === target.kind && s.targetId === target.id && s.grantee === (grantee?.id ?? null),
		);
		const share: ShareRow = existing
			? { ...existing, role: grantee ? role : 'view' }
			: {
					id: grantee ? newId() : randomSecret(),
					targetKind: target.kind,
					targetId: target.id,
					grantee: grantee?.id ?? null,
					role: grantee ? role : 'view',
					createdAt: now,
				};
		await tx
			.insert(shares)
			.values({ userId: owner, ...share })
			.onConflictDoUpdate({ target: [shares.userId, shares.id], set: { role: share.role } });
		const next = { ...space, shares: [...space.shares.filter(s => s.id !== share.id), share] };
		if (grantee) {
			await rememberPerson(tx, owner, grantee, now);
			await syncAccess(tx, next);
		}
		return shareView(tx, next, origin, share);
	});
}

export function deleteShare(db: Db, owner: string, id: string): Promise<void> {
	return withSpaceLocked(db, owner, async (tx, space) => {
		const share = space.shares.find(s => s.id === id);
		if (!share) throw new ORPCError('NOT_FOUND', { message: 'No such share' });
		await tx.delete(shares).where(and(eq(shares.userId, owner), eq(shares.id, id)));
		if (share.grantee) await syncAccess(tx, { ...space, shares: space.shares.filter(s => s.id !== id) });
	});
}

/** Public links through the agent API, so a guest cannot publish what it was shared. */

export function listLinks(db: Db, space: Space, access: Access, origin: string) {
	requireManager(access);
	return Promise.all(space.shares.filter(share => share.grantee === null).map(s => shareView(db, space, origin, s)));
}

export function createLink(db: Db, space: Space, access: Access, origin: string, target: ShareTarget, now: number) {
	requireManager(access);
	return createShare(db, space.owner, origin, target, null, 'view', now);
}

export async function deleteLink(db: Db, space: Space, access: Access, id: string) {
	requireManager(access);
	if (!space.shares.some(share => share.id === id && share.grantee === null)) {
		throw new ORPCError('NOT_FOUND', { message: 'No such link' });
	}
	await deleteShare(db, space.owner, id);
}

export async function sharedView(app: App, ownerId: string, id: string): Promise<SharedView> {
	const space = await loadSpace(app.db, ownerId);
	const share = space.shares.find(s => s.id === id && s.grantee === null);
	if (!share) throw new ORPCError('NOT_FOUND', { message: 'No such link' });
	const owner = await userById(app, ownerId);
	if (!owner) throw new ORPCError('NOT_FOUND', { message: 'No such link' });
	const { tasks, projects, sections, labels } = filterSnapshot(space.snapshot, scopeOf(space.snapshot, [share]));
	return { target: { kind: share.targetKind, id: share.targetId }, owner, tasks, projects, sections, labels };
}

export async function peopleOf(db: Db, owner: string): Promise<Person[]> {
	const rows = await db.select().from(people).where(eq(people.userId, owner));
	return rows.map(({ id, name, kind, ownerId }) => ({ id, name, kind, ownerId }));
}

const tokenView = ({ id, aiUserId, name, createdAt, lastUsedAt }: ApiToken): ApiToken => ({
	id,
	aiUserId,
	name,
	createdAt,
	lastUsedAt,
});

export async function listTokens(db: Db, owner: string): Promise<ApiToken[]> {
	return (await db.select().from(apiTokens).where(eq(apiTokens.userId, owner))).map(tokenView);
}

/** Only an AI this space was shared to by its owner, which `ai.create` arranges, can get a token. */
async function ownAi(db: Db, space: Space, aiUserId: string) {
	const [ai] = await db.select({ kind: user.kind, ownerId: user.ownerId }).from(user).where(eq(user.id, aiUserId));
	const shared = space.shares.some(share => share.grantee === aiUserId);
	if (!ai || ai.kind !== 'ai' || ai.ownerId !== space.owner || !shared) {
		throw new ORPCError('NOT_FOUND', { message: 'No such AI account' });
	}
}

export async function createToken(
	db: Db,
	space: Space,
	origin: string,
	aiUserId: string,
	name: string,
	now: number,
): Promise<CreatedApiToken> {
	await ownAi(db, space, aiUserId);
	const secret = randomSecret();
	const id = newId();
	await db.insert(apiTokens).values({
		userId: space.owner,
		id,
		aiUserId,
		name,
		tokenHash: await sha256(secret),
		createdAt: now,
		lastUsedAt: null,
	});
	const token = `pm.${space.owner}.${secret}`;
	return { id, token, prompt: agentPrompt(origin, token) };
}

export async function deleteToken(db: Db, owner: string, id: string): Promise<void> {
	const deleted = await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.userId, owner), eq(apiTokens.id, id)))
		.returning({ id: apiTokens.id });
	if (!deleted.length) throw new ORPCError('NOT_FOUND', { message: 'No such token' });
}

/** An AI account was deleted: its tokens and shares go. It never had `access` rows. */
export async function revokeAi(db: Db, owner: string, aiUserId: string): Promise<void> {
	await db.delete(apiTokens).where(and(eq(apiTokens.userId, owner), eq(apiTokens.aiUserId, aiUserId)));
	await db.delete(shares).where(and(eq(shares.userId, owner), eq(shares.grantee, aiUserId)));
}

/** Link shares have no grantee; this lists the ids the owner shared with people, for people search. */
export async function granteesOf(db: Db, owner: string): Promise<string[]> {
	const rows = await db
		.selectDistinct({ grantee: shares.grantee })
		.from(shares)
		.where(and(eq(shares.userId, owner), isNotNull(shares.grantee)));
	return rows.map(row => row.grantee).filter((id): id is string => id !== null);
}

/** The owners of every space shared with `grantee`, from Better Auth's users, so a guest can name them. */
export async function ownersSharingWith(db: Db, grantee: string): Promise<Person[]> {
	const rows = await db.selectDistinct({ owner: shares.userId }).from(shares).where(eq(shares.grantee, grantee));
	const owners = rows.map(row => row.owner);
	if (!owners.length) return [];
	return db
		.select({ id: user.id, name: user.name, kind: user.kind, ownerId: user.ownerId })
		.from(user)
		.where(inArray(user.id, owners));
}
