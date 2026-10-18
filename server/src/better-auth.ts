import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import type { AuthMethods } from '../../shared/api/contract';
import { settings } from '../../shared/db/schema';
import { SETTINGS_ID } from '../../shared/model';
import type { Person } from '../../shared/sharing';
import type { App } from './app';
import { authSchema } from './db/auth-schema';
import type { Db } from './db/postgres';
import type { AppleSecret, Config } from './config';
import { reportError } from './sentry';
import { base64urlEncode } from './web-push';

/** A year. Days offline must not sign the account out; a day online extends the session. */
const SESSION_SECONDS = 60 * 60 * 24 * 365;
const SESSION_UPDATE_SECONDS = 60 * 60 * 24;
/** How long a request trusts the signed session cookie before reading the session row again. */
const COOKIE_CACHE_SECONDS = 60 * 5;
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

type UserRow = { id: string; email: string; name: string; kind?: 'human' | 'ai' | null; ownerId?: string | null };

export type Auth = {
	handler: (request: Request) => Promise<Response>;
	api: { getSession: (input: { headers: Headers }) => Promise<{ user: UserRow } | null> };
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

/** A provider without credentials is hidden, so CI boots without them. */
export function authMethods({ google, apple }: Config): AuthMethods {
	return {
		email: true,
		google: google.web !== null,
		apple: Boolean(apple?.servicesId),
		googleIosClientId: google.iosClientId,
		appleNative: apple !== null,
	};
}

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
	const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })));
	const payload = base64urlEncode(
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
	return `${signingInput}.${base64urlEncode(signature)}`;
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

/** Signing Apple's secret is a WebCrypto call, so the providers are built once per config, not per request. */
const providersByConfig = new WeakMap<Config, Promise<Record<string, unknown>>>();
function cachedProviders(config: Config) {
	const existing = providersByConfig.get(config);
	if (existing) return existing;
	const created = socialProviders(config);
	providersByConfig.set(config, created);
	return created;
}

/** Better Auth on the app database, whose migrations create its tables. */
export async function createAuth(config: Config, db: Db): Promise<Auth> {
	const options = {
		appName: 'procrastimate',
		secret: config.authSecret,
		baseURL: {
			allowedHosts: ALLOWED_HOSTS,
			protocol: 'auto' as const,
			fallback: 'https://procrastimate.stf.lol',
		},
		trustedOrigins,
		database: drizzleAdapter(db, { provider: 'pg', schema: authSchema, transaction: true }),
		emailAndPassword: { enabled: true },
		// `input: false` keeps sign-up from claiming to be an AI account or naming an owner.
		user: {
			additionalFields: {
				kind: { type: 'string', required: false, defaultValue: 'human', input: false },
				ownerId: { type: 'string', required: false, input: false },
			},
		},
		socialProviders: await cachedProviders(config),
		// Settings exist for every user from sign-up; clients only ever patch them.
		databaseHooks: {
			user: {
				create: {
					after: async (user: { id: string }) => {
						await db.insert(settings).values({ userId: user.id, id: SETTINGS_ID }).onConflictDoNothing();
					},
				},
			},
		},
		session: {
			expiresIn: SESSION_SECONDS,
			updateAge: SESSION_UPDATE_SECONDS,
			cookieCache: { enabled: true, maxAge: COOKIE_CACHE_SECONDS },
		},
		plugins: [bearer()],
		advanced: { trustedProxyHeaders: true, cookiePrefix: 'procrastimate' },
		// Counters in the database, so every Worker isolate enforces the same limits.
		rateLimit: config.authRateLimit ? { enabled: true, storage: 'database' as const } : { enabled: false },
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
	return betterAuth(options as never) as Auth;
}

export type SessionUser = Person & { email: string };

const asPerson = (row: UserRow): Person => ({
	id: row.id,
	name: row.name,
	kind: row.kind ?? 'human',
	ownerId: row.ownerId ?? null,
});

/**
 * Better Auth throws where its handler would answer an error. A refused credential is no session; anything else, a
 * database that cannot be read above all, stays an error, so the request answers 5xx and the clients keep their
 * session instead of signing out on the 401 a swallowed failure would turn into.
 */
export async function readSession(request: Request, { auth }: App): Promise<SessionUser | null> {
	const session = await auth.api.getSession({ headers: request.headers }).catch((error: unknown) => {
		if (error instanceof APIError && error.statusCode === 401) return null;
		throw error;
	});
	if (!session?.user.id) return null;
	return { ...asPerson(session.user), email: session.user.email ?? '' };
}

const users = async ({ auth }: App) => (await auth.$context).adapter;

export async function aiAccounts(app: App, ownerId: string): Promise<Person[]> {
	const rows = await (
		await users(app)
	).findMany<UserRow>({ model: 'user', where: [{ field: 'ownerId', value: ownerId }] });
	return rows.filter(row => row.kind === 'ai').map(asPerson);
}

/** A user that can never sign in: no credential row, and an email nobody receives. */
export async function createAiUser(app: App, ownerId: string, name: string): Promise<Person> {
	const now = new Date();
	const row = await (
		await users(app)
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

export async function deleteUser({ auth }: App, userId: string): Promise<void> {
	const context = await auth.$context;
	await context.internalAdapter.deleteUser(userId);
	await context.internalAdapter.deleteUserSessions(userId);
	await context.internalAdapter.deleteAccounts(userId);
}
