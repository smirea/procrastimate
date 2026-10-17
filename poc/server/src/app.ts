import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, jwt } from 'better-auth/plugins';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { access, authSchema, tasks } from './schema';

export type Db = PostgresJsDatabase<Record<string, never>>;
export type AppConfig = { db: Db; powersyncUrl: string; baseURL: string; secret: string };

type CrudOp = { op: 'PUT' | 'PATCH' | 'DELETE'; type: string; id: string; data?: Record<string, unknown> };

const COLUMNS = Object.fromEntries(
	Object.entries(tasks)
		.filter(([, c]) => c && typeof c === 'object' && 'name' in c)
		.map(([key, c]) => [(c as { name: string }).name, key]),
);

function toRow(data: Record<string, unknown>) {
	const row: Record<string, unknown> = {};
	for (const [column, value] of Object.entries(data)) {
		const key = COLUMNS[column];
		if (!key || key === 'id') continue;
		row[key] = (key === 'labelIds' || key === 'due') && typeof value === 'string' ? JSON.parse(value) : value;
	}
	return row;
}

export function createApp(config: AppConfig) {
	const auth = betterAuth({
		baseURL: config.baseURL,
		secret: config.secret,
		database: drizzleAdapter(config.db, { provider: 'pg', schema: authSchema }),
		emailAndPassword: { enabled: true },
		trustedOrigins: ['http://127.0.0.1:58083', 'http://localhost:58083'],
		plugins: [bearer(), jwt({ jwt: { audience: 'powersync', expirationTime: '5m' } })],
	});

	async function actorOf(request: Request) {
		const session = await auth.api.getSession({ headers: request.headers });
		return session?.user.id ?? null;
	}

	async function canWrite(actor: string, op: CrudOp, owner: string | undefined) {
		const existing = await config.db.select({ userId: tasks.userId }).from(tasks).where(eq(tasks.id, op.id));
		const space = existing[0]?.userId ?? owner;
		if (!space || space === actor) return true;
		const grant = await config.db
			.select({ role: access.role })
			.from(access)
			.where(and(eq(access.grantee, actor), eq(access.entityId, op.id)));
		return grant[0]?.role === 'edit';
	}

	async function upload(request: Request) {
		const actor = await actorOf(request);
		if (!actor) return new Response('unauthorized', { status: 401 });
		const { batch } = (await request.json()) as { batch: CrudOp[] };
		const rejected: string[] = [];
		const started = performance.now();
		await config.db.transaction(async tx => {
			for (const op of batch) {
				if (op.type !== 'tasks') {
					rejected.push(op.id);
					continue;
				}
				const row = toRow(op.data ?? {});
				if (!(await canWrite(actor, op, row.userId as string | undefined))) {
					rejected.push(op.id);
					continue;
				}
				if (op.op === 'PUT') {
					const values = { ...row, id: op.id, createdBy: actor } as typeof tasks.$inferInsert;
					await tx.insert(tasks).values(values).onConflictDoUpdate({ target: tasks.id, set: row });
				} else if (op.op === 'PATCH') {
					delete row.userId;
					if (Object.keys(row).length) await tx.update(tasks).set(row).where(eq(tasks.id, op.id));
				} else {
					await tx.delete(tasks).where(eq(tasks.id, op.id));
				}
			}
		});
		return Response.json({ rejected, ms: Math.round(performance.now() - started) });
	}

	async function share(request: Request) {
		const actor = await actorOf(request);
		if (!actor) return new Response('unauthorized', { status: 401 });
		const { taskId, grantee, role } = (await request.json()) as {
			taskId: string;
			grantee: string;
			role: 'view' | 'edit' | null;
		};
		const id = `${grantee}:task:${taskId}`;
		if (role === null) await config.db.delete(access).where(eq(access.id, id));
		else
			await config.db
				.insert(access)
				.values({ id, grantee, owner: actor, kind: 'task', entityId: taskId, role })
				.onConflictDoUpdate({ target: access.id, set: { role } });
		return Response.json({ ok: true });
	}

	async function powersync(request: Request, path: string) {
		const url = new URL(request.url);
		const upstream = new URL(path + url.search, config.powersyncUrl);
		const headers = new Headers(request.headers);
		headers.delete('host');
		headers.delete('cookie');
		headers.set('accept-encoding', 'identity');
		const response = await fetch(upstream, {
			method: request.method,
			headers,
			body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
			// @ts-expect-error Bun and workerd both stream a request body with duplex half.
			duplex: 'half',
		});
		const out = new Headers(response.headers);
		out.delete('content-encoding');
		out.delete('content-length');
		return new Response(response.body, { status: response.status, headers: out });
	}

	return async function handle(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith('/api/auth/')) return auth.handler(request);
		if (pathname === '/api/upload' && request.method === 'POST') return upload(request);
		if (pathname === '/api/share' && request.method === 'POST') return share(request);
		if (pathname.startsWith('/api/powersync/')) return powersync(request, pathname.slice('/api/powersync'.length));
		if (pathname === '/api/whoami') return Response.json({ user: await actorOf(request) });
		return new Response('not found', { status: 404 });
	};
}
