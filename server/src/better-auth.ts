import { ORPCError } from '@orpc/server';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from '@better-auth/memory-adapter';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import type { AuthMethods } from '../../shared/api/contract';
import type { Person } from '../../shared/sharing';
import type { Env } from './bindings';
import { authSchema } from './db/auth-schema';
import { config, type AppleSecret, type Config } from './config';
import { tursoDatabase, type TursoDatabase } from './db/turso';
import { reportError } from './sentry';
import { internalClient } from './account/peers';

/** A year. Days offline must not sign the account out; a day online extends the session. */
const SESSION_SECONDS = 60 * 60 * 24 * 365;
const SESSION_UPDATE_SECONDS = 60 * 60 * 24;
const APPLE_BUNDLE_ID = 'com.stefan.procrastimate';
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

/** What the sign-in screen may offer. A provider without credentials is hidden, so CI boots without them. */
export function authMethods(env: Env): AuthMethods {
	const { google, apple } = config(env);
	return {
		email: true,
		google: google.web !== null,
		apple: Boolean(apple?.servicesId),
		googleIosClientId: google.iosClientId,
		appleNative: apple !== null,
	};
}

const bytesToBase64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');

/** Apple's client secret is an ES256 JWT. A stored JWT wins; otherwise the Worker mints one from the .p8. */
export async function appleClientSecret(secret: AppleSecret, servicesId: string | null): Promise<string> {
	if (secret.kind === 'stored') return secret.jwt;
	const { teamId, keyId, pem } = secret;
	const subject = servicesId ?? APPLE_BUNDLE_ID;
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

async function socialProviders({ google, apple }: Config) {
	const providers: Record<string, unknown> = {};
	const googleIds = [google.web?.clientId, google.iosClientId].filter(id => id !== undefined && id !== null);
	if (googleIds.length) {
		providers.google = {
			clientId: googleIds.length === 1 ? googleIds[0] : googleIds,
			clientSecret: google.web?.clientSecret ?? 'ios-id-token-only',
		};
	}
	if (apple) {
		const appleSecret = await appleClientSecret(apple.secret, apple.servicesId);
		const ids = [apple.servicesId, APPLE_BUNDLE_ID].filter(id => id !== null);
		providers.apple = {
			clientId: ids.length === 1 ? ids[0] : ids,
			clientSecret: appleSecret,
			// `appBundleIdentifier` alone would drop the Services ID from the accepted audiences.
			audience: ids,
		};
	}
	return providers;
}

function authOptions(secret: string, database: unknown, providers: Record<string, unknown>, durableLimits: boolean) {
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
		// Better Auth answers its own failures, a 500 included, so they reach Sentry only through its logger.
		logger: {
			log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]) => {
				console[level](`better-auth: ${message}`, ...args);
				if (level !== 'error') return;
				const error = args.find(arg => arg instanceof Error) ?? new Error(`better-auth: ${message}`);
				reportError(error, 'error', { message, args });
			},
		},
	};
}

/** Better Auth on the account database, whose migrations create its tables. */
const drizzleDatabase = (db: TursoDatabase) =>
	drizzleAdapter(db, { provider: 'sqlite', schema: authSchema, transaction: true });

async function buildAuth(settings: Config, db: TursoDatabase | null): Promise<Auth> {
	const providers = await socialProviders(settings);
	const { authSecret } = settings;
	const database = db ? drizzleDatabase(db) : memoryAdapter(memoryDb(authSecret));
	return betterAuth(authOptions(authSecret, database, providers, Boolean(db)) as never) as Auth;
}

function memoryDb(secret: string): MemoryDB {
	const existing = memoryDatabases.get(secret);
	if (existing) return existing;
	const created: MemoryDB = { user: [], session: [], account: [], verification: [] };
	memoryDatabases.set(secret, created);
	return created;
}

/** One auth instance per secret and database. The account binding is not part of the key. */
export function getAuth(env: Env): Promise<Auth> {
	const settings = config(env);
	const { authSecret, turso, google, apple } = settings;
	const key = [
		authSecret,
		turso?.url ?? 'memory',
		google.web?.clientId,
		google.iosClientId,
		apple?.servicesId,
		apple?.secret.kind === 'key' ? apple.secret.keyId : apple?.secret.kind,
	].join('|');
	const existing = auths.get(key);
	if (existing) return existing;
	const database = turso ? tursoDatabase(turso) : Promise.resolve(null);
	const pending = database
		.then(db => buildAuth(settings, db))
		.catch(error => {
			auths.delete(key);
			throw error;
		});
	auths.set(key, pending);
	return pending;
}

export function authOnDatabase(secret: string, db: TursoDatabase): Auth {
	return betterAuth(authOptions(secret, drizzleDatabase(db), {}, true) as never) as Auth;
}

export async function authHandler(request: Request, env: Env): Promise<Response> {
	return (await getAuth(env)).handler(request);
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
	const url = new URL('/api/auth/get-session', request.url);
	const response = await auth.handler(new Request(url, { method: 'GET', headers: request.headers }));
	if (!response.ok) return null;
	const body = (await response.json().catch(() => null)) as { user?: Partial<UserRow> } | null;
	if (!body?.user?.id) return null;
	const { id, email = '', name = '', kind, ownerId } = body.user;
	return { ...asPerson({ id, email, name, kind, ownerId }), email };
}

const users = async (env: Env) => (await (await getAuth(env)).$context).adapter;

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
	const context = await (await getAuth(env)).$context;
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
