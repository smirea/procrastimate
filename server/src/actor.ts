import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';
import { appClientSchema, CLIENT_HEADER, type Actor } from '../../shared/auth';
import { apiTokens } from '../../shared/db/schema';
import type { Client } from '../../shared/values';
import type { App } from './app';
import { sha256 } from './auth';
import { readSession, userById } from './better-auth';
import { identify } from './sentry';

/**
 * Who a request is from: a Better Auth session, or an AI account's `pm.<ownerId>.<secret>` bearer, which names the
 * owner whose `api_tokens` row holds the secret's hash.
 */

const TOKEN_PREFIX = 'pm.';

function bearer(request: Request): string | null {
	const header = request.headers.get('authorization') ?? '';
	return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
}

async function tokenActor(token: string, app: App): Promise<Actor | null> {
	const [ownerId, secret, ...rest] = token.slice(TOKEN_PREFIX.length).split('.');
	if (!ownerId || !secret || rest.length) return null;
	const [row] = await app.db
		.select({ aiUserId: apiTokens.aiUserId })
		.from(apiTokens)
		.where(and(eq(apiTokens.userId, ownerId), eq(apiTokens.tokenHash, await sha256(secret))));
	if (!row) return null;
	const ai = await userById(app, row.aiUserId);
	return ai?.kind === 'ai' && ai.ownerId === ownerId ? ai : null;
}

/** Also names the caller in Sentry, for the rest of the request. */
export async function readActor(request: Request, app: App): Promise<Actor | null> {
	const token = bearer(request);
	const actor = token?.startsWith(TOKEN_PREFIX) ? await tokenActor(token, app) : await readSession(request, app);
	if (actor) identify(actor);
	return actor;
}

export async function requireActor(request: Request, app: App): Promise<Actor> {
	const actor = await readActor(request, app);
	if (!actor) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
	return actor;
}

/** The human-only routes: sync, uploads, shares, tokens, push. An AI account acts through the agent API. */
export async function requireHuman(request: Request, app: App): Promise<Actor> {
	const actor = await requireActor(request, app);
	if (actor.kind !== 'human') throw new ORPCError('FORBIDDEN', { message: 'Not for AI accounts' });
	return actor;
}

/** The space a request is for: `?space=`, else the actor's own, which for an AI is its owner's. */
export function spaceOf(url: URL, actor: Actor): string {
	return url.searchParams.get('space') || actor.ownerId || actor.id;
}

/**
 * The app a request came from. The web and iOS send `x-procrastimate-client`; any other caller is an `api` client known
 * by its `User-Agent`. A header that does not parse is null, so the request is refused rather than recorded as `api`.
 */
export function clientOf(request: Request): Client | null {
	const header = request.headers.get(CLIENT_HEADER);
	if (header === null) {
		const agent = request.headers.get('user-agent');
		return { kind: 'api', version: null, device: agent ? agent.slice(0, 200) : null, os: null, timeZone: null };
	}
	try {
		const parsed = appClientSchema.safeParse(JSON.parse(header));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
