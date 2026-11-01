import { ORPCError } from '@orpc/server';
import { and, eq, or } from 'drizzle-orm';
import { appClientSchema, CLIENT_HEADER, DEVICE_HEADER, DEVICE_PROTOCOL_PREFIX, type Actor } from '../../shared/auth';
import { apiTokens } from '../../shared/db/schema';
import { user } from './db/auth-schema';
import type { Client } from '../../shared/values';
import type { App } from './app';
import { readSession } from './better-auth';
import { identify } from './sentry';

/**
 * Who a request is from: a Better Auth session, or a `pm.<ownerId>.<secret>` bearer, which names the owner whose
 * `api_tokens` row holds the secret's hash and acts as that row's AI account, or as the owner for a personal token. A session bearer, which iOS sends, is resolved once a minute
 * per isolate, the same trust the web's signed cookie cache gives, so a revoked token works for at most a minute.
 */

const TOKEN_PREFIX = 'pm.';
const SESSION_CACHE_MS = 60_000;
const SESSION_CACHE_ROWS = 1000;

const sessions = new Map<string, { actor: Actor; until: number }>();

async function sessionActor(token: string, request: Request, app: App): Promise<Actor | null> {
	const cached = sessions.get(token);
	if (cached && cached.until > Date.now()) return cached.actor;
	const actor = await readSession(request, app);
	if (!actor) {
		sessions.delete(token);
		return null;
	}
	if (sessions.size >= SESSION_CACHE_ROWS) sessions.clear();
	sessions.set(token, { actor, until: Date.now() + SESSION_CACHE_MS });
	return actor;
}

/** Sign-out drops the token from this isolate's cache, so the signed-out device is refused at once. */
export function forgetSession(request: Request): void {
	const token = bearer(request);
	if (token) sessions.delete(token);
}

function bearer(request: Request): string | null {
	const header = request.headers.get('authorization') ?? '';
	return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
}

async function tokenActor(token: string, app: App): Promise<Actor | null> {
	const [ownerId, secret, ...rest] = token.slice(TOKEN_PREFIX.length).split('.');
	if (!ownerId || !secret || rest.length) return null;
	const [actor] = await app.db
		.select({ id: user.id, name: user.name, kind: user.kind, ownerId: user.ownerId })
		.from(apiTokens)
		.innerJoin(user, eq(user.id, apiTokens.aiUserId))
		.where(
			and(
				eq(apiTokens.userId, ownerId),
				eq(apiTokens.tokenHash, await sha256(secret)),
				or(eq(user.id, ownerId), and(eq(user.kind, 'ai'), eq(user.ownerId, ownerId))),
			),
		);
	return actor ?? null;
}

/** Also names the caller in Sentry, for the rest of the request. */
export async function readActor(request: Request, app: App): Promise<Actor | null> {
	const token = bearer(request);
	const actor = token
		? token.startsWith(TOKEN_PREFIX)
			? await tokenActor(token, app)
			: await sessionActor(token, request, app)
		: await readSession(request, app);
	if (actor) identify(actor);
	return actor;
}

export async function requireActor(request: Request, app: App): Promise<Actor> {
	const actor = await readActor(request, app);
	if (!actor) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
	return actor;
}

/** An AI account acts through the agent API. */
export async function requireHuman(request: Request, app: App): Promise<Actor> {
	const actor = await requireActor(request, app);
	if (actor.kind !== 'human') throw new ORPCError('FORBIDDEN', { message: 'Not for AI accounts' });
	return actor;
}

/** The space a request is for: `?space=`, else the actor's own, which for an AI is its owner's. */
export function spaceOf(actor: Actor, space?: string | null): string {
	return space || actor.ownerId || actor.id;
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

const encoder = new TextEncoder();
const DEVICE_ID = /^[A-Za-z0-9_-]{8,80}$/;

export async function sha256(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
	return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The install id a push route or a socket upgrade names, from its header or its subprotocol. */
export function deviceIdFrom(request: Request): string | null {
	const header = request.headers.get(DEVICE_HEADER);
	if (header && DEVICE_ID.test(header)) return header;
	const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(value => value.trim());
	const protocol = protocols.find(value => value.startsWith(DEVICE_PROTOCOL_PREFIX));
	const id = protocol ? protocol.slice(DEVICE_PROTOCOL_PREFIX.length) : '';
	return DEVICE_ID.test(id) ? id : null;
}
