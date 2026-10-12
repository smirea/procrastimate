import { createClient, type Client } from '@libsql/client/web';
import { LibsqlDialect } from '@libsql/kysely-libsql';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from '@better-auth/memory-adapter';
import { getMigrations } from 'better-auth/db/migration';
import { bearer } from 'better-auth/plugins';
import { USER_HEADER } from '../../shared/auth';
import type { Env } from './bindings';
import { tursoTarget } from './db/turso';
import { withUser } from './request-user';

/** A year. Days offline must not sign the account out; a day online extends the session. */
const SESSION_SECONDS = 60 * 60 * 24 * 365;
const SESSION_UPDATE_SECONDS = 60 * 60 * 24;
const APPLE_BUNDLE_ID = 'com.stefan.procrastimate';
/** Used when `E2E_SHARD` is set, so the suite never needs the real secret and never touches Turso. */
export const E2E_AUTH_SECRET = 'e2e-better-auth-secret-0123456789';

const ALLOWED_HOSTS = [
	'procrastimate.stf.lol',
	'procrastimate.localhost:6120',
	'127.0.0.1:*',
	'localhost:*',
	'procrastimate.test',
];

const TRUSTED_ORIGINS = [
	'https://procrastimate.stf.lol',
	'http://procrastimate.localhost:6120',
	'http://127.0.0.1:6130',
	'http://127.0.0.1:6120',
	'http://127.0.0.1:6121',
	'http://localhost:6130',
	'http://localhost:6120',
	'https://procrastimate.test',
	'http://procrastimate.test',
];

/** Loopback ports are chosen by the dev server and the test suite, so they cannot be listed one by one. */
function trustedOrigins(request?: Request): string[] {
	const origin = request?.headers.get('origin') ?? '';
	const loopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? [origin] : [];
	return [...TRUSTED_ORIGINS, ...loopback];
}

export type AuthMethods = {
	email: boolean;
	/** Web redirect. The iOS client id alone does not turn this on. */
	google: boolean;
	/** Web redirect through the Services ID. */
	apple: boolean;
	/** Public iOS client id, or null when Google sign-in on the phone is off. */
	googleIosClientId: string | null;
	/** Native Sign in with Apple, whose audience is the bundle id. */
	appleNative: boolean;
};

type Auth = {
	handler: (request: Request) => Promise<Response>;
	options: Parameters<typeof getMigrations>[0];
	$context: Promise<{
		internalAdapter: {
			deleteUser: (userId: string) => Promise<void>;
			deleteUserSessions: (userId: string) => Promise<void>;
			deleteAccounts: (userId: string) => Promise<void>;
		};
	}>;
};

const memoryDatabases = new Map<string, MemoryDB>();
const auths = new Map<string, Promise<Auth>>();

const trim = (value: string | undefined) => {
	const next = value?.trim();
	return next ? next : '';
};

/** The secret Better Auth will use, or null when sign-in is off. A deploy without one must not fall back to a public secret. */
export function authSecret(env: Env): string | null {
	if (env.E2E_SHARD) return E2E_AUTH_SECRET;
	return trim(env.BETTER_AUTH_SECRET) || null;
}

function appleKeyReady(env: Env): boolean {
	return Boolean(trim(env.APPLE_TEAM_ID) && trim(env.APPLE_KEY_ID) && trim(env.APPLE_PRIVATE_KEY));
}

/** What the sign-in screen may offer. Empty credentials hide a provider, so CI boots without them. */
export function authMethods(env: Env): AuthMethods {
	const appleReady = Boolean(trim(env.APPLE_CLIENT_SECRET) || appleKeyReady(env));
	return {
		email: authSecret(env) !== null,
		google: Boolean(trim(env.GOOGLE_CLIENT_ID) && trim(env.GOOGLE_CLIENT_SECRET)),
		apple: Boolean(trim(env.APPLE_CLIENT_ID) && appleReady),
		googleIosClientId: trim(env.GOOGLE_IOS_CLIENT_ID) || null,
		appleNative: appleReady,
	};
}

const bytesToBase64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');

/** Apple's client secret is an ES256 JWT. A stored JWT wins; otherwise the Worker mints one from the .p8. */
export async function appleClientSecret(env: Env): Promise<string | null> {
	const stored = trim(env.APPLE_CLIENT_SECRET);
	if (stored) return stored;
	const teamId = trim(env.APPLE_TEAM_ID);
	const keyId = trim(env.APPLE_KEY_ID);
	const pem = trim(env.APPLE_PRIVATE_KEY).replaceAll('\\n', '\n');
	const subject = trim(env.APPLE_CLIENT_ID) || APPLE_BUNDLE_ID;
	if (!teamId || !keyId || !pem.includes('PRIVATE KEY')) return null;
	const body = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s/g, '');
	const der = Uint8Array.from(atob(body), char => char.charCodeAt(0));
	const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
	const now = Math.floor(Date.now() / 1000);
	const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })));
	const payload = bytesToBase64Url(
		new TextEncoder().encode(
			JSON.stringify({
				iss: teamId,
				iat: now,
				exp: now + 60 * 60 * 24 * 150,
				aud: 'https://appleid.apple.com',
				sub: subject,
			}),
		),
	);
	const signingInput = `${header}.${payload}`;
	const signature = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)),
	);
	return `${signingInput}.${bytesToBase64Url(signature)}`;
}

async function socialProviders(env: Env) {
	const providers: Record<string, unknown> = {};
	const webGoogle = trim(env.GOOGLE_CLIENT_ID);
	const iosGoogle = trim(env.GOOGLE_IOS_CLIENT_ID);
	const googleSecret = trim(env.GOOGLE_CLIENT_SECRET);
	const googleIds = [webGoogle, iosGoogle].filter(Boolean);
	if (googleIds.length && (googleSecret || iosGoogle)) {
		providers.google = {
			clientId: googleIds.length === 1 ? googleIds[0] : googleIds,
			clientSecret: googleSecret || 'ios-id-token-only',
		};
	}
	const appleSecret = await appleClientSecret(env);
	if (appleSecret) {
		const services = trim(env.APPLE_CLIENT_ID);
		const ids = [services, APPLE_BUNDLE_ID].filter(Boolean);
		providers.apple = {
			clientId: ids.length === 1 ? ids[0] : ids,
			clientSecret: appleSecret,
			// `appBundleIdentifier` alone would drop the Services ID from the accepted audiences.
			audience: ids,
		};
	}
	return providers;
}

function authOptions(
	secret: string,
	_env: Env,
	database: unknown,
	providers: Record<string, unknown>,
	durableLimits: boolean,
) {
	return {
		appName: 'procrastimate',
		secret,
		baseURL: {
			allowedHosts: ALLOWED_HOSTS,
			protocol: 'auto' as const,
			fallback: 'https://procrastimate.stf.lol',
		},
		trustedOrigins,
		database,
		emailAndPassword: { enabled: true },
		socialProviders: providers,
		session: { expiresIn: SESSION_SECONDS, updateAge: SESSION_UPDATE_SECONDS },
		plugins: [bearer()],
		advanced: { trustedProxyHeaders: true, cookiePrefix: 'procrastimate' },
		// Memory counters reset with each isolate. The Turso table survives, which is what production has.
		rateLimit: durableLimits ? { enabled: true, storage: 'database' as const } : { enabled: false },
		telemetry: { enabled: false },
	};
}

async function buildAuth(env: Env, secret: string, client: Client | null): Promise<Auth> {
	const providers = await socialProviders(env);
	const database = client
		? { dialect: new LibsqlDialect({ client: client as never }), type: 'sqlite' as const, transaction: true }
		: memoryAdapter(memoryDb(secret));
	const auth = betterAuth(authOptions(secret, env, database, providers, Boolean(client)) as never) as Auth;
	if (client) await getMigrations(auth.options).then(plan => plan.runMigrations());
	return auth;
}

function memoryDb(secret: string): MemoryDB {
	const existing = memoryDatabases.get(secret);
	if (existing) return existing;
	const created: MemoryDB = { user: [], session: [], account: [], verification: [] };
	memoryDatabases.set(secret, created);
	return created;
}

/** One auth instance per secret and database. The account binding is not part of the key. */
export function getAuth(env: Env): Promise<Auth | null> {
	const secret = authSecret(env);
	if (!secret) return Promise.resolve(null);
	const turso = tursoTarget(env);
	const key = [
		secret,
		turso?.url ?? 'memory',
		trim(env.GOOGLE_CLIENT_ID),
		trim(env.GOOGLE_IOS_CLIENT_ID),
		trim(env.APPLE_CLIENT_ID),
		trim(env.APPLE_KEY_ID),
	].join('|');
	const existing = auths.get(key);
	if (existing) return existing;
	const client = turso ? createClient({ url: turso.url, authToken: turso.authToken }) : null;
	const pending = buildAuth(env, secret, client).catch(error => {
		auths.delete(key);
		throw error;
	});
	auths.set(key, pending);
	return pending;
}

/** Signs up against a caller-supplied libSQL client. The transaction test uses this with `transaction: true`. */
export async function authOnClient(secret: string, client: Client): Promise<Auth> {
	const auth = betterAuth(
		authOptions(
			secret,
			{},
			{ dialect: new LibsqlDialect({ client: client as never }), type: 'sqlite', transaction: true },
			{},
			true,
		) as never,
	) as Auth;
	await getMigrations(auth.options).then(plan => plan.runMigrations());
	return auth;
}

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export function methodsResponse(env: Env): Response {
	return Response.json(authMethods(env));
}

export async function authHandler(request: Request, env: Env): Promise<Response> {
	const auth = await getAuth(env);
	if (!auth) return fail(503, 'Sign-in is not configured');
	return auth.handler(request);
}

export type SessionUser = { id: string; email: string; name: string };

/** The signed-in user, from the session cookie or the bearer plugin's `Authorization` header. */
export async function readSession(request: Request, env: Env): Promise<SessionUser | null> {
	const auth = await getAuth(env);
	if (!auth) return null;
	const url = new URL('/api/auth/get-session', request.url);
	const response = await auth.handler(new Request(url, { method: 'GET', headers: request.headers }));
	if (!response.ok) return null;
	const body = (await response.json().catch(() => null)) as {
		user?: { id?: string; email?: string; name?: string };
	} | null;
	if (!body?.user?.id) return null;
	return { id: body.user.id, email: body.user.email ?? '', name: body.user.name ?? '' };
}

/**
 * Deletes the signed-in user and their tasks. The confirmation lives in Settings. Social accounts have no
 * password, so this route does not ask for one.
 */
export async function deleteAccount(request: Request, env: Env): Promise<Response> {
	const auth = await getAuth(env);
	if (!auth) return fail(503, 'Sign-in is not configured');
	if (!env.ACCOUNT) return fail(503, 'Sync is not configured');
	const user = await readSession(request, env);
	if (!user) return fail(401, 'Not signed in');
	const wipe = new Request(new URL('/api/account/wipe', request.url), {
		method: 'POST',
		headers: withUser(request, user.id).headers,
	});
	const wiped = await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).fetch(wipe as never);
	if (!wiped.ok) return wiped as unknown as Response;
	const context = await auth.$context;
	await context.internalAdapter.deleteUser(user.id);
	await context.internalAdapter.deleteUserSessions(user.id);
	await context.internalAdapter.deleteAccounts(user.id);
	return Response.json({ ok: true });
}

export { USER_HEADER };
