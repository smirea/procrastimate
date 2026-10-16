import { ORPCError } from '@orpc/server';
import { newId } from '../../../shared/id';
import type {
	ApiToken,
	CreatedApiToken,
	Person,
	ShareTarget,
	ShareView,
	SharedView,
	Space,
} from '../../../shared/sharing';
import { filterSnapshot, scopeOf } from '../../../shared/scope';
import type { Role } from '../../../shared/values';
import { sha256, type AccountContext } from '../auth';
import { agentPrompt } from '../docs';
import { requireManager } from './commands';
import { personOf } from './activity';
import type { AccountStore, PersonRow, ShareRow } from './store';
import { accountSnapshot } from './sync';

/**
 * Shares, memberships, people, and API tokens, all rows in the owner's space. Better Auth is the Worker's, so
 * anything that needs a user looked up arrives here already resolved as a `Person`.
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

export const asPerson = ({ id, name, kind, ownerId }: Person): Person => ({ id, name, kind, ownerId });

export function rememberPerson(store: AccountStore, person: Person, now: number) {
	store.upsertPerson({ ...asPerson(person), seenAt: now });
}

function shareView(store: AccountStore, space: string, origin: string, share: ShareRow): ShareView {
	return {
		id: share.id,
		target: { kind: share.targetKind, id: share.targetId },
		grantee: share.grantee === null ? null : personOf(store, share.grantee),
		role: share.role,
		createdAt: share.createdAt,
		url: share.grantee === null ? linkUrl(origin, space, share.id) : null,
	};
}

export function listShares({ store, space, origin }: AccountContext): ShareView[] {
	return store.shares().map(share => shareView(store, space, origin, share));
}

/** A target must be live in the space. The whole space has no id. */
function checkTarget(store: AccountStore, target: ShareTarget) {
	if (target.kind === 'space') return;
	const snapshot = accountSnapshot(store);
	const list =
		target.kind === 'project' ? snapshot.projects : target.kind === 'label' ? snapshot.labels : snapshot.tasks;
	if (!list.some(entity => entity.id === target.id)) throw new ORPCError('NOT_FOUND', { message: 'No such target' });
}

/**
 * Writes the share, remembers the grantee, and tells the grantee's space after this request leaves the queue. A link
 * is always read only. Sharing the same target with the same audience again keeps the row, so a link's URL stays
 * stable and a user's role is simply updated.
 */
export function createShare(
	context: AccountContext,
	target: ShareTarget,
	grantee: Person | null,
	role: Role,
): ShareView {
	const { store, now, space, origin } = context;
	checkTarget(store, target);
	const existing = store
		.shares()
		.find(s => s.targetKind === target.kind && s.targetId === target.id && s.grantee === (grantee?.id ?? null));
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
	store.putShare(share);
	if (grantee) {
		rememberPerson(store, grantee, now);
		tellMembership(context, grantee, true);
	}
	return shareView(store, space, origin, share);
}

/** Public links through the agent API, so a guest cannot publish what it was shared. */

export function listLinks(context: AccountContext): ShareView[] {
	requireManager(context.access);
	return listShares(context).filter(share => share.grantee === null);
}

export function createLink(context: AccountContext, target: ShareTarget): ShareView {
	requireManager(context.access);
	return createShare(context, target, null, 'view');
}

export function deleteLink(context: AccountContext, id: string) {
	requireManager(context.access);
	if (!context.store.shares().some(share => share.id === id && share.grantee === null)) {
		throw new ORPCError('NOT_FOUND', { message: 'No such link' });
	}
	deleteShare(context, id);
}

export function deleteShare(context: AccountContext, id: string) {
	const { store } = context;
	const share = store.shares().find(s => s.id === id);
	if (!share) throw new ORPCError('NOT_FOUND', { message: 'No such share' });
	store.deleteShare(id);
	if (share.grantee && !store.shares().some(s => s.grantee === share.grantee)) {
		tellMembership(context, personOf(store, share.grantee), false);
	}
}

/** AI accounts have no space of their own to list, so only humans hear about memberships. */
function tellMembership(context: AccountContext, grantee: Person, live: boolean) {
	if (grantee.kind !== 'human') return;
	const owner = personOf(context.store, context.space);
	context.defer(async () => {
		await context.peer(grantee.id)?.membership({ spaceId: context.space, owner, live });
	});
}

/** Every human the space is shared with, whose spaces hear when this one moves. */
export function liveGuests(store: AccountStore): string[] {
	const people = new Map(store.people().map(row => [row.id, row]));
	const ids = new Set<string>();
	for (const share of store.shares()) {
		if (share.grantee && people.get(share.grantee)?.kind !== 'ai') ids.add(share.grantee);
	}
	return [...ids];
}

export function recordMembership(store: AccountStore, spaceId: string, owner: Person, live: boolean, now: number) {
	if (!live) {
		store.deleteMembership(spaceId);
		return;
	}
	rememberPerson(store, owner, now);
	if (!store.memberships().some(m => m.spaceId === spaceId)) store.putMembership({ spaceId, createdAt: now });
}

export function listSpaces(store: AccountStore): Space[] {
	return store.memberships().map(({ spaceId }) => ({ id: spaceId, owner: personOf(store, spaceId) }));
}

export function sharedView(store: AccountStore, space: string, id: string): SharedView {
	const share = store.shares().find(s => s.id === id && s.grantee === null);
	if (!share) throw new ORPCError('NOT_FOUND', { message: 'No such link' });
	const snapshot = accountSnapshot(store);
	const { tasks, projects, sections, labels } = filterSnapshot(snapshot, scopeOf(snapshot, [share]));
	return {
		target: { kind: share.targetKind, id: share.targetId },
		owner: personOf(store, space),
		tasks,
		projects,
		sections,
		labels,
	};
}

const tokenView = ({ id, aiUserId, name, createdAt, lastUsedAt }: ApiToken): ApiToken => ({
	id,
	aiUserId,
	name,
	createdAt,
	lastUsedAt,
});

export const listTokens = (store: AccountStore): ApiToken[] => store.apiTokens().map(tokenView);

/** Only an AI this space was shared to by its owner, which `ai.create` arranges, can get a token. */
function ownAi(store: AccountStore, space: string, aiUserId: string): PersonRow {
	const ai = store.people().find(person => person.id === aiUserId);
	const shared = store.shares().some(share => share.grantee === aiUserId);
	if (!ai || ai.kind !== 'ai' || ai.ownerId !== space || !shared) {
		throw new ORPCError('NOT_FOUND', { message: 'No such AI account' });
	}
	return ai;
}

export async function createToken(
	{ store, now, space, origin }: AccountContext,
	aiUserId: string,
	name: string,
): Promise<CreatedApiToken> {
	ownAi(store, space, aiUserId);
	const secret = randomSecret();
	const tokenHash = await sha256(secret);
	const id = newId();
	store.putApiToken({ id, aiUserId, name, tokenHash, createdAt: now, lastUsedAt: null });
	const token = `pm.${space}.${secret}`;
	return { id, token, prompt: agentPrompt(origin, token) };
}

export function deleteToken(store: AccountStore, id: string) {
	if (!store.apiTokens().some(token => token.id === id)) throw new ORPCError('NOT_FOUND', { message: 'No such token' });
	store.deleteApiToken(id);
}

export async function resolveToken(store: AccountStore, secret: string, now: number): Promise<string | null> {
	const token = store.apiTokenByHash(await sha256(secret));
	if (!token) return null;
	store.touchApiToken(token.id, now);
	return token.aiUserId;
}

export function revokeAi(store: AccountStore, aiUserId: string) {
	for (const token of store.apiTokens()) if (token.aiUserId === aiUserId) store.deleteApiToken(token.id);
	for (const share of store.shares()) if (share.grantee === aiUserId) store.deleteShare(share.id);
}
