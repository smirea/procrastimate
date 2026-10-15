import { ORPCError } from '@orpc/server';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from '@better-auth/memory-adapter';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import type { AuthMethods } from '../../shared/api/contract';
import type { Person } from '../../shared/sharing';
import type { Env } from './bindings';
import { authSchema } from './db/auth-schema';
import { tursoDatabase, tursoTarget, type TursoDatabase } from './db/turso';
import { errorResponse } from './errors';
import { internalClient } from './account/peers';

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

type Where = { field: string; value: string };

/** A `user` row with the sharing fields. Rows from before them read as humans. */
type UserRow = { id: string; email: string; name: string; kind?: 'human' | 'ai' | null; ownerId?: string | null };

type Auth = {
	handler: (request: Request) => Promise<Response>;
	$context: Promise<{
		adapter: {
			create: <T>(data: { model: string; data: Record<string, unknown> }) => Promise<T>;
			findOne: <T>(data: { model: string; where: Where[] }) => Promise<T | null>;
			findMany: <T>(data: { model: string; where?: Where[] }) => Promise<T[]>;
		};
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
		// `input: false` keeps sign-up from claiming to be an AI account or naming an owner.
		user: {
			additionalFields: {
				kind: { type: 'string', required: false, defaultValue: 'human', input: false },
				ownerId: { type: 'string', required: false, input: false },
			},
		},
		socialProviders: providers,
		session: { expiresIn: SESSION_SECONDS, updateAge: SESSION_UPDATE_SECONDS },
		plugins: [bearer()],
		advanced: { trustedProxyHeaders: true, cookiePrefix: 'procrastimate' },
		// Memory counters reset with each isolate. The Turso table survives, which is what production has.
		rateLimit: durableLimits ? { enabled: true, storage: 'database' as const } : { enabled: false },
		telemetry: { enabled: false },
	};
}

/** Better Auth on the account database, whose migrations create its tables. */
const drizzleDatabase = (db: TursoDatabase) =>
	drizzleAdapter(db, { provider: 'sqlite', schema: authSchema, transaction: true });

async function buildAuth(env: Env, secret: string, db: TursoDatabase | null): Promise<Auth> {
	const providers = await socialProviders(env);
	const database = db ? drizzleDatabase(db) : memoryAdapter(memoryDb(secret));
	return betterAuth(authOptions(secret, env, database, providers, Boolean(db)) as never) as Auth;
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
	const database = turso ? tursoDatabase(turso) : Promise.resolve(null);
	const pending = database
		.then(db => buildAuth(env, secret, db))
		.catch(error => {
			auths.delete(key);
			throw error;
		});
	auths.set(key, pending);
	return pending;
}

export function authOnDatabase(secret: string, db: TursoDatabase): Auth {
	return betterAuth(authOptions(secret, {}, drizzleDatabase(db), {}, true) as never) as Auth;
}

export async function authHandler(request: Request, env: Env): Promise<Response> {
	const auth = await getAuth(env);
	if (!auth) return errorResponse('SERVICE_UNAVAILABLE', 'Sign-in is not configured');
	return auth.handler(request);
}

export type SessionUser = Person & { email: string };

const asPerson = (row: UserRow): Person => ({
	id: row.id,
	name: row.name,
	kind: row.kind ?? 'human',
	ownerId: row.ownerId ?? null,
});

export async function readSession(request: Request, env: Env): Promise<SessionUser | null> {
	const auth = await getAuth(env);
	if (!auth) return null;
	const url = new URL('/api/auth/get-session', request.url);
	const response = await auth.handler(new Request(url, { method: 'GET', headers: request.headers }));
	if (!response.ok) return null;
	const body = (await response.json().catch(() => null)) as { user?: Partial<UserRow> } | null;
	if (!body?.user?.id) return null;
	const { id, email = '', name = '', kind, ownerId } = body.user;
	return { ...asPerson({ id, email, name, kind, ownerId }), email };
}

const users = async (env: Env) => (await (await getAuth(env))!.$context).adapter;

export async function userById(env: Env, id: string): Promise<Person | null> {
	const row = await (await users(env)).findOne<UserRow>({ model: 'user', where: [{ field: 'id', value: id }] });
	return row ? asPerson(row) : null;
}

export async function userByEmail(env: Env, email: string): Promise<Person | null> {
	const row = await (await users(env)).findOne<UserRow>({ model: 'user', where: [{ field: 'email', value: email }] });
	return row ? asPerson(row) : null;
}

/** The AI accounts `ownerId` made, oldest first. */
export async function aiAccounts(env: Env, ownerId: string): Promise<Person[]> {
	const rows = await (
		await users(env)
	).findMany<UserRow>({ model: 'user', where: [{ field: 'ownerId', value: ownerId }] });
	return rows.filter(row => row.kind === 'ai').map(asPerson);
}

/** A user that can never sign in: no credential row, and an email nobody receives. */
export async function createAiUser(env: Env, ownerId: string, name: string): Promise<Person> {
	const now = new Date();
	const row = await (
		await users(env)
	).create<UserRow>({
		model: 'user',
		data: {
			name,
			email: `ai-${crypto.randomUUID()}@ai.procrastimate.invalid`,
			emailVerified: false,
			kind: 'ai',
			ownerId,
			createdAt: now,
			updatedAt: now,
		},
	});
	return asPerson(row);
}

export async function deleteUser(env: Env, userId: string): Promise<void> {
	const context = await (await getAuth(env))!.$context;
	await context.internalAdapter.deleteUser(userId);
	await context.internalAdapter.deleteUserSessions(userId);
	await context.internalAdapter.deleteAccounts(userId);
}

/**
 * Deletes the signed-in human, their tasks, and the AI accounts they made. The confirmation lives in Settings.
 * Social accounts have no password, so this does not ask for one.
 */
export async function deleteAccount(request: Request, env: Env, user: Person): Promise<void> {
	if (!env.ACCOUNT) throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Sync is not configured' });
	await internalClient(env.ACCOUNT, user.id, new URL(request.url).origin).wipe();
	for (const ai of await aiAccounts(env, user.id)) await deleteUser(env, ai.id);
	await deleteUser(env, user.id);
}
