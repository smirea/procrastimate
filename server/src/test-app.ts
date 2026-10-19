import { PGlite } from '@electric-sql/pglite';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import devJwtKey from '../../powersync/local/INSECURE-dev-jwt-key.json' with { type: 'json' };
import { CLIENT_HEADER, DEVICE_HEADER } from '../../shared/auth';
import { tasks } from '../../shared/db/schema';
import type { Person, ShareView } from '../../shared/sharing';
import { handle } from './api';
import { createApp, type App } from './app';
import type { Env } from './bindings';
import { migratedSnapshot } from './db/pglite-snapshot';
import type { Db } from './db/postgres';
import { rambleRoute, type ConnectUpstream } from './ramble';
import { generateVapidKeys } from './web-push';

/**
 * The server under test: Postgres compiled to WebAssembly (PGlite) in the test process, migrated with the real
 * migrations, behind the same `handle` the Worker serves. Each `testApp()` is a fresh database loaded from one migrated
 * snapshot (`db/pglite-snapshot.ts`). Tests call routes the
 * way clients do; nothing here reaches into the store.
 */

export const ORIGIN = 'https://procrastimate.test';

let vapid: Promise<{ publicKey: string; privateKey: string }> | undefined;

export async function testEnv(overrides: Partial<Env> = {}): Promise<Env> {
	vapid ??= generateVapidKeys();
	const keys = await vapid;
	return {
		DATABASE_URL: 'postgres://pglite',
		POWERSYNC_URL: 'http://127.0.0.1:1',
		POWERSYNC_JWT_PRIVATE_KEY: JSON.stringify(devJwtKey),
		BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef',
		AUTH_RATE_LIMIT: 'off',
		VAPID_PUBLIC_KEY: keys.publicKey,
		VAPID_PRIVATE_KEY: keys.privateKey,
		SENTRY_ENVIRONMENT: '',
		...overrides,
	};
}

export type TestApp = App & {
	fetch: (path: string, init?: RequestInit) => Promise<Response>;
	close: () => Promise<void>;
	/** Every SQL statement Drizzle ran since the last `statements.length = 0`, for the write-cost tests. */
	statements: string[];
};

/** A fresh PGlite database, migrated, with the app on top. Sockets are refused; Ramble tests pass their own config. */
export async function testApp(options: { env?: Partial<Env>; connect?: ConnectUpstream } = {}): Promise<TestApp> {
	const client = new PGlite({ loadDataDir: migratedSnapshot() });
	// `close()` before PGlite has started never settles.
	await client.waitReady;
	const statements: string[] = [];
	const db: Db = drizzle(client, { logger: { logQuery: query => void statements.push(query) } });
	const env = await testEnv(options.env);
	const stream = () => Response.json({ ok: false, error: 'No sockets in tests' }, { status: 501 });
	const app = await createApp(env, db, rambleRoute(db, stream, options.connect ?? null));
	return {
		...app,
		fetch: (path, init) => handle(new Request(`${ORIGIN}${path}`, init), app),
		close: () => client.close(),
		statements,
	};
}

export type Session = { person: Person; token: string; headers: Record<string, string> };

const webClient = JSON.stringify({ kind: 'web', version: '1.0', device: 'test', os: 'test', timeZone: 'UTC' });

export async function signUp(app: TestApp, name = 'Test', deviceId: string = crypto.randomUUID()): Promise<Session> {
	const response = await app.fetch('/api/auth/sign-up/email', {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: ORIGIN },
		body: JSON.stringify({
			email: `${name.toLowerCase()}-${crypto.randomUUID()}@procrastimate.test`,
			password: 'test-password-1',
			name,
		}),
	});
	if (!response.ok) throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
	const token = response.headers.get('set-auth-token');
	if (!token) throw new Error('sign-up did not return a session token');
	const { user } = (await response.json()) as { user: { id: string; name: string } };
	return {
		person: { id: user.id, name: user.name, kind: 'human', ownerId: null },
		token,
		headers: {
			authorization: `Bearer ${token}`,
			origin: ORIGIN,
			'content-type': 'application/json',
			[CLIENT_HEADER]: webClient,
			[DEVICE_HEADER]: deviceId,
		},
	};
}

export const tokenHeaders = (token: string): Record<string, string> => ({
	authorization: `Bearer ${token}`,
	origin: ORIGIN,
	'content-type': 'application/json',
});

/** `select tasks`, `insert log`, `lock`: the verb and the first table each statement names, then any lateral read's. */
export function named(statement: string): string {
	if (statement.startsWith('SELECT pg_advisory_xact_lock')) return 'lock';
	if (/^(savepoint|release)/i.test(statement)) return statement.split(' ')[0]!.toLowerCase();
	const verb = /^\(*(select|insert|update|delete)\b/.exec(statement)?.[1];
	const table = /\b(?:from|into|update)\s+"(\w+)"/.exec(statement)?.[1];
	const lateral = [...statement.matchAll(/join lateral \(select .*? from "(\w+)"/g)].map(match => match[1]);
	return [`${verb} ${table}`, ...lateral].join(' + ');
}

export async function json<T>(pending: Response | Promise<Response>): Promise<T> {
	const response = await pending;
	if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
	return (await response.json()) as T;
}

/** `owner` shares `target` with `userId`, as the share sheet does. */
export const shareWith = (
	app: TestApp,
	owner: Session,
	target: { kind: string; id: string },
	userId: string,
	role: 'view' | 'edit',
) =>
	json<ShareView>(
		app.fetch('/api/shares', {
			method: 'POST',
			headers: owner.headers,
			body: JSON.stringify({ target, audience: { kind: 'user', userId, role } }),
		}),
	);

/** A new AI account of `owner`'s, which starts with the whole space shared, and a token for it. */
export async function aiAccount(app: TestApp, owner: Session, name = 'Bot') {
	const post = (path: string, body: unknown) =>
		app.fetch(path, { method: 'POST', headers: owner.headers, body: JSON.stringify(body) });
	const person = await json<Person>(post('/api/ai', { name }));
	const { token } = await json<{ token: string }>(post('/api/ai-tokens', { aiUserId: person.id, name: 'laptop' }));
	return { person, token, headers: tokenHeaders(token) };
}

const taskColumns = getTableColumns(tasks);

/** A whole `tasks` row as a PowerSync PUT carries it: every column by its SQL name, JSON columns as text. */
export function taskRow(id: string, userId: string, title: string, extra: Record<string, unknown> = {}) {
	const fields: Record<string, unknown> = {
		id,
		userId,
		parentId: null,
		order: 0,
		title,
		notes: '',
		projectId: null,
		sectionId: null,
		labelIds: '[]',
		due: null,
		recurrence: null,
		priority: 4,
		reminders: '[]',
		location: null,
		event: null,
		images: '[]',
		createdAt: 1_700_000_000_000,
		completedAt: null,
		createdBy: null,
		completedBy: null,
		lastCompletedAt: null,
		sourceKey: null,
		...extra,
	};
	return Object.fromEntries(
		Object.entries(fields).map(([key, value]) => [taskColumns[key as keyof typeof taskColumns].name, value]),
	);
}

type Rejected = { table: string; id: string; reason: string }[];

export const upload = (app: TestApp, session: Session, writes: unknown[]) =>
	json<{ rejected: Rejected }>(
		app.fetch('/api/upload', { method: 'POST', headers: session.headers, body: JSON.stringify({ writes }) }),
	).then(body => body.rejected);
