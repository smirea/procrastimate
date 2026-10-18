import { ORPCError } from '@orpc/server';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { apiTokens, labels, projects, shares, tasks, type ShareRow } from '../../shared/db/schema';
import { newId } from '../../shared/id';
import { filterTree, scopeOf } from '../../shared/scope';
import type { ApiToken, CreatedApiToken, Person, ShareTarget, ShareView, SharedView } from '../../shared/sharing';
import type { Role } from '../../shared/values';
import { syncAccess } from './access';
import type { App } from './app';
import { sha256 } from './auth';
import { user } from './db/auth-schema';
import type { Db } from './db/postgres';
import { requireManager } from './commands';
import { agentPrompt } from './docs';
import { peopleById, personById, unknownPerson } from './people';
import { entity, loadTree, withSpaceLocked } from './space';
import type { Access } from './auth';
import { base64urlEncode } from './web-push';

/**
 * Shares, public links, and API tokens, all rows in the owner's space. Every share change recomputes the owner's
 * `access` rows, which is what moves a guest's PowerSync view.
 */

/** The link token is `<ownerId>.<id>`, and the share's id is the secret. */
export const linkUrl = (origin: string, ownerId: string, id: string) => `${origin}/s/${ownerId}.${id}`;

function randomSecret(): string {
	return base64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
}

function shareView(owner: string, origin: string, share: ShareRow, grantee: Person | null): ShareView {
	return {
		id: share.id,
		target: { kind: share.targetKind, id: share.targetId },
		grantee,
		role: share.role,
		createdAt: share.createdAt,
		url: share.grantee === null ? linkUrl(origin, owner, share.id) : null,
	};
}

async function shareViews(db: Db, owner: string, origin: string, list: readonly ShareRow[]): Promise<ShareView[]> {
	const people = await peopleById(
		db,
		list.flatMap(share => (share.grantee ? [share.grantee] : [])),
	);
	return list.map(share =>
		shareView(
			owner,
			origin,
			share,
			share.grantee === null ? null : (people.get(share.grantee) ?? unknownPerson(share.grantee)),
		),
	);
}

const sharesOf = (db: Db, owner: string, where?: SQL) =>
	db
		.select()
		.from(shares)
		.where(and(eq(shares.userId, owner), where))
		.then(rows => rows.map(entity));

export const listShares = async (db: Db, owner: string, origin: string) =>
	shareViews(db, owner, origin, await sharesOf(db, owner));

const TARGET_TABLES = { project: projects, label: labels, task: tasks };

/** A target must be a row of the space. The whole space has no id. */
async function targetExists(db: Db, owner: string, target: ShareTarget): Promise<boolean> {
	if (target.kind === 'space') return true;
	const table = TARGET_TABLES[target.kind];
	const [row] = await db
		.select({ id: table.id })
		.from(table)
		.where(and(eq(table.userId, owner), eq(table.id, target.id)));
	return row !== undefined;
}

/**
 * Writes the share under the space's lock, so a recompute of `access` after an upload cannot run from the shares it
 * read before. A link is always read only. Sharing the same target with the same audience again keeps the row, so a
 * link's URL stays stable and a user's role is simply updated.
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
	return withSpaceLocked(db, owner, async tx => {
		const [found, [existing]] = await Promise.all([
			targetExists(tx, owner, target),
			sharesOf(
				tx,
				owner,
				and(
					eq(shares.targetKind, target.kind),
					eq(shares.targetId, target.id),
					grantee ? eq(shares.grantee, grantee.id) : isNull(shares.grantee),
				),
			),
		]);
		if (!found) throw new ORPCError('NOT_FOUND', { message: 'No such target' });
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
		if (grantee) await syncAccess(tx, owner, grantee.id);
		return shareView(owner, origin, share, grantee);
	});
}

export function deleteShare(db: Db, owner: string, id: string): Promise<void> {
	return withSpaceLocked(db, owner, async tx => {
		const [share] = await tx
			.delete(shares)
			.where(and(eq(shares.userId, owner), eq(shares.id, id)))
			.returning({ grantee: shares.grantee });
		if (!share) throw new ORPCError('NOT_FOUND', { message: 'No such share' });
		if (share.grantee) await syncAccess(tx, owner, share.grantee);
	});
}

/** Public links through the agent API, so a guest cannot publish what it was shared. */

export async function listLinks(db: Db, owner: string, access: Access, origin: string) {
	requireManager(access);
	return shareViews(db, owner, origin, await sharesOf(db, owner, isNull(shares.grantee)));
}

export function createLink(db: Db, owner: string, access: Access, origin: string, target: ShareTarget, now: number) {
	requireManager(access);
	return createShare(db, owner, origin, target, null, 'view', now);
}

/** A link moves no one's `access` rows, so its delete takes no lock. */
export async function deleteLink(db: Db, owner: string, access: Access, id: string) {
	requireManager(access);
	const deleted = await db
		.delete(shares)
		.where(and(eq(shares.userId, owner), eq(shares.id, id), isNull(shares.grantee)))
		.returning({ id: shares.id });
	if (!deleted.length) throw new ORPCError('NOT_FOUND', { message: 'No such link' });
}

/** Read by anyone holding the link: the share is checked before anything else of the space is read. */
export async function sharedView(app: App, ownerId: string, id: string): Promise<SharedView> {
	const [share] = await sharesOf(app.db, ownerId, and(eq(shares.id, id), isNull(shares.grantee)));
	if (!share) throw new ORPCError('NOT_FOUND', { message: 'No such link' });
	const [owner, tree] = await Promise.all([personById(app.db, ownerId), loadTree(app.db, ownerId)]);
	if (!owner) throw new ORPCError('NOT_FOUND', { message: 'No such link' });
	const { tasks, projects, sections, labels } = filterTree(tree, scopeOf(tree, [share]));
	return { target: { kind: share.targetKind, id: share.targetId }, owner, tasks, projects, sections, labels };
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

/** Only an AI this space was shared to by its owner, which `ai.create` arranges, can get a token. One select. */
async function ownAi(db: Db, owner: string, aiUserId: string) {
	const [ai] = await db
		.select({ id: user.id })
		.from(user)
		.innerJoin(shares, and(eq(shares.userId, owner), eq(shares.grantee, user.id)))
		.where(and(eq(user.id, aiUserId), eq(user.kind, 'ai'), eq(user.ownerId, owner)))
		.limit(1);
	if (!ai) throw new ORPCError('NOT_FOUND', { message: 'No such AI account' });
}

export async function createToken(
	db: Db,
	owner: string,
	origin: string,
	aiUserId: string,
	name: string,
	now: number,
): Promise<CreatedApiToken> {
	await ownAi(db, owner, aiUserId);
	const secret = randomSecret();
	const id = newId();
	await db.insert(apiTokens).values({
		userId: owner,
		id,
		aiUserId,
		name,
		tokenHash: await sha256(secret),
		createdAt: now,
		lastUsedAt: null,
	});
	const token = `pm.${owner}.${secret}`;
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
export function revokeAi(db: Db, owner: string, aiUserId: string): Promise<void> {
	return withSpaceLocked(db, owner, async tx => {
		await tx.delete(apiTokens).where(and(eq(apiTokens.userId, owner), eq(apiTokens.aiUserId, aiUserId)));
		await tx.delete(shares).where(and(eq(shares.userId, owner), eq(shares.grantee, aiUserId)));
		await syncAccess(tx, owner, aiUserId);
	});
}
