import { ORPCError } from '@orpc/server';
import { ACTOR_HEADER, actorSchema, type Actor } from '../../shared/auth';
import { accountContract } from '../../shared/api/contract';
import { internalClient } from './account/peers';
import { readSession, userById } from './better-auth';
import type { Env } from './bindings';
import { routeKeys } from './routes';

/**
 * Who a request is from. The Worker resolves a Better Auth session, or an AI account's `pm.<ownerId>.<secret>`
 * bearer through the owner's space, into an `Actor` and puts it on the forwarded request as JSON. A space's
 * `Account` object trusts only that header.
 */

const TOKEN_PREFIX = 'pm.';

function bearer(request: Request): string | null {
	const header = request.headers.get('authorization') ?? '';
	return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
}

async function tokenActor(token: string, request: Request, env: Env): Promise<Actor | null> {
	const [ownerId, secret, ...rest] = token.slice(TOKEN_PREFIX.length).split('.');
	if (!ownerId || !secret || rest.length || !env.ACCOUNT) return null;
	const owner = internalClient(env.ACCOUNT, ownerId, new URL(request.url).origin);
	const { aiUserId } = await owner.resolveToken({ secret });
	if (!aiUserId) return null;
	const ai = await userById(env, aiUserId);
	return ai?.kind === 'ai' && ai.ownerId === ownerId ? ai : null;
}

export async function readActor(request: Request, env: Env): Promise<Actor | null> {
	const token = bearer(request);
	if (token?.startsWith(TOKEN_PREFIX)) return tokenActor(token, request, env);
	const user = await readSession(request, env);
	return user ? { id: user.id, name: user.name, kind: user.kind, ownerId: user.ownerId } : null;
}

/** The Worker's human-only routes. An AI account acts only through the routes in `AI_ROUTES`. */
export async function requireHuman(request: Request, env: Env): Promise<Actor> {
	const actor = await readActor(request, env);
	if (!actor) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
	if (actor.kind !== 'human') throw new ORPCError('FORBIDDEN', { message: 'Not for AI accounts' });
	return actor;
}

/** The account routes an AI account, or a guest of a space, may call. Everything else is the human owner's. */
export const SHARED_ROUTES: ReadonlySet<string> = new Set(
	routeKeys({
		sync: accountContract.sync,
		view: accountContract.view,
		tasks: accountContract.tasks,
		activity: accountContract.activity,
	}),
);

/** The space a request is for: `?space=`, else the actor's own, which for an AI is its owner's. */
export function spaceOf(url: URL, actor: Actor): string {
	return url.searchParams.get('space') || actor.ownerId || actor.id;
}

/**
 * Cloning the request sets the actor header. Bun's WebSocket upgrade still needs the request the server received,
 * so the clone remembers it.
 */
const originals = new WeakMap<Request, Request>();

export function withActor(request: Request, actor: Actor): Request {
	const headers = new Headers(request.headers);
	headers.set(ACTOR_HEADER, JSON.stringify(actor));
	const next = new Request(request, { headers });
	originals.set(next, originals.get(request) ?? request);
	return next;
}

export function originalRequest(request: Request): Request {
	return originals.get(request) ?? request;
}

export function actorOf(request: Request): Actor | null {
	const header = request.headers.get(ACTOR_HEADER);
	if (!header) return null;
	try {
		const parsed = actorSchema.safeParse(JSON.parse(header));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
