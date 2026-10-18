/**
 * Proves the sync loop against a running server: `bun scripts/sync-smoke.ts [--api http://127.0.0.1:6281]
 * [--database postgres://…]`. Exits non-zero on the first failure. The API and database default to the worktree's
 * `.env.override`.
 */
import { eq, getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { join } from 'node:path';
import postgres from 'postgres';
import { access, tasks } from '../shared/db/schema';
import { readOverride } from './local-stack';

const args = process.argv.slice(2);
const flag = (name: string) => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};
const override = readOverride(join(import.meta.dir, '..'));
const api = flag('--api') ?? override?.API_URL ?? 'http://127.0.0.1:6121';
const databaseUrl = flag('--database') ?? override?.DATABASE_URL;
const origin = api;

function check(condition: unknown, message: string): asserts condition {
	if (!condition) {
		console.error(`FAIL ${message}`);
		process.exit(1);
	}
	console.log(`ok   ${message}`);
}

async function json<T>(response: Response, what: string): Promise<T> {
	check(response.ok, `${what} answered ${response.status}`);
	return (await response.json()) as T;
}

async function signUp(name: string) {
	const email = `${name}-${Date.now()}@smoke.test`;
	const response = await fetch(`${api}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { origin, 'content-type': 'application/json' },
		body: JSON.stringify({ email, password: 'smoke-password-123', name }),
	});
	const body = await json<{ user: { id: string } }>(response, `sign up ${name}`);
	const bearer = response.headers.get('set-auth-token');
	check(bearer, `sign up ${name} returned a bearer token`);
	return {
		id: body.user.id,
		headers: { origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
	};
}

type StreamLine =
	| { checkpoint: unknown }
	| { checkpoint_diff: { removed_buckets: string[] } }
	| { checkpoint_complete: unknown }
	| { data: { bucket: string; data: { op: string; object_type: string; object_id: string; data: string | null }[] } }
	| { token_expires_in: number };

/**
 * PowerSync's newline-delimited sync stream, read across several waits. Every line is kept, and a wait scans the
 * history before reading more, so a row that arrived while the script looked for something else still counts.
 */
function openStream(response: Response) {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	const history: StreamLine[] = [];
	let buffer = '';
	let pending: ReturnType<typeof reader.read> | null = null;
	return {
		seen: (matches: (line: StreamLine) => boolean) => history.some(matches),
		async until(matches: (line: StreamLine) => boolean, timeoutMs: number): Promise<boolean> {
			const deadline = Date.now() + timeoutMs;
			let scanned = 0;
			while (Date.now() < deadline) {
				for (; scanned < history.length; scanned++) if (matches(history[scanned]!)) return true;
				pending ??= reader.read();
				const next = await Promise.race([pending, Bun.sleep(deadline - Date.now()).then(() => null)]);
				if (!next || next.done) return false;
				pending = null;
				buffer += decoder.decode(next.value, { stream: true });
				const parts = buffer.split('\n');
				buffer = parts.pop() ?? '';
				for (const text of parts) if (text.trim()) history.push(JSON.parse(text) as StreamLine);
			}
			return false;
		},
	};
}
type SyncStream = ReturnType<typeof openStream>;

const rowLine =
	(table: string, id: string, op: 'PUT' | 'REMOVE', predicate?: (row: Record<string, unknown>) => boolean) =>
	(line: StreamLine) =>
		'data' in line &&
		line.data.data.some(
			entry =>
				entry.object_type === table &&
				entry.object_id === id &&
				entry.op === op &&
				(!predicate || predicate(JSON.parse(entry.data ?? '{}') as Record<string, unknown>)),
		);

function waitFor(
	stream: SyncStream,
	table: string,
	id: string,
	op: 'PUT' | 'REMOVE',
	predicate?: (row: Record<string, unknown>) => boolean,
) {
	return stream.until(rowLine(table, id, op, predicate), 15_000);
}

const columns = getTableColumns(tasks);
/** A `tasks` row as PowerSync's upload queue sends it: every column by its SQL name, JSON columns as text. */
function wireTask(id: string, userId: string, title: string): Record<string, unknown> {
	const row: Record<string, unknown> = {
		id,
		userId,
		parentId: null,
		order: 0,
		title,
		notes: '',
		projectId: null,
		sectionId: null,
		labelIds: '[]',
		due: JSON.stringify({ date: '2026-10-18', time: null }),
		recurrence: null,
		priority: 2,
		reminders: '[]',
		location: null,
		event: null,
		images: '[]',
		createdAt: Date.now(),
		completedAt: null,
		createdBy: 'client-lies',
		completedBy: null,
		lastCompletedAt: null,
		sourceKey: null,
	};
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [columns[key as keyof typeof columns].name, value]),
	);
}

const started = performance.now();
const owner = await signUp('owner');
const other = await signUp('other');

const { token, endpoint } = await json<{ token: string; endpoint: string }>(
	await fetch(`${api}/api/sync/token`, { headers: owner.headers }),
	'GET /api/sync/token',
);
check(endpoint === `${origin}/api/powersync`, `endpoint is the proxy: ${endpoint}`);

const response = await fetch(`${endpoint}/sync/stream`, {
	method: 'POST',
	headers: { authorization: `Token ${token}`, 'content-type': 'application/json' },
	body: JSON.stringify({
		buckets: [],
		include_checksum: true,
		raw_data: true,
		client_id: `smoke-${crypto.randomUUID()}`,
		streams: { include_defaults: true, subscriptions: [] },
	}),
});
check(response.ok, `sync stream opened through the proxy (${response.status})`);
check(!response.headers.get('content-encoding'), 'proxy stripped content-encoding');
const stream = openStream(response);
check(await stream.until(line => 'checkpoint_complete' in line, 15_000), 'first checkpoint completed');

const upload = (writes: unknown[]) =>
	fetch(`${api}/api/upload`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ writes }) });
let result: { rejected: { table: string; id: string; reason: string }[] };

const uploadAs = (who: typeof owner, writes: unknown[]) =>
	fetch(`${api}/api/upload`, { method: 'POST', headers: who.headers, body: JSON.stringify({ writes }) });
const sharedId = crypto.randomUUID();
result = await json(
	await upload([{ op: 'put', table: 'tasks', id: sharedId, values: wireTask(sharedId, owner.id, 'Shared task') }]),
	'upload shared task',
);
check(result.rejected.length === 0, 'shared task put accepted');
const share = await json<{ id: string; grantee: { id: string } | null }>(
	await fetch(`${api}/api/shares`, {
		method: 'POST',
		headers: owner.headers,
		body: JSON.stringify({
			target: { kind: 'task', id: sharedId },
			audience: { kind: 'user', userId: other.id, role: 'edit' },
		}),
	}),
	'POST /api/shares to other, edit',
);
check(share.grantee?.id === other.id, 'share names the grantee');

const otherToken = await json<{ token: string; endpoint: string }>(
	await fetch(`${api}/api/sync/token`, { headers: other.headers }),
	'other GET /api/sync/token',
);
const otherResponse = await fetch(`${otherToken.endpoint}/sync/stream`, {
	method: 'POST',
	headers: { authorization: `Token ${otherToken.token}`, 'content-type': 'application/json' },
	body: JSON.stringify({
		buckets: [],
		include_checksum: true,
		raw_data: true,
		client_id: `smoke-${crypto.randomUUID()}`,
		streams: { include_defaults: true, subscriptions: [] },
	}),
});
check(otherResponse.ok, 'other opened a sync stream');
const otherStream = openStream(otherResponse);
check(
	await waitFor(otherStream, 'tasks', sharedId, 'PUT', row => row.user_id === owner.id),
	'other receives the shared task through the access table',
);
check(
	await waitFor(otherStream, 'access', `${other.id}:task:${sharedId}`, 'PUT', row => row.role === 'edit'),
	'other receives the access row with role edit',
);

result = await json(
	await uploadAs(other, [{ op: 'patch', table: 'tasks', id: sharedId, values: { title: 'Edited by guest' } }]),
	'guest patch of the shared task',
);
check(result.rejected.length === 0, 'guest patch admitted');
check(
	await waitFor(stream, 'tasks', sharedId, 'PUT', row => row.title === 'Edited by guest'),
	"owner's stream shows the guest's edit",
);

const subtaskId = crypto.randomUUID();
result = await json(
	await uploadAs(other, [
		{
			op: 'put',
			table: 'tasks',
			id: subtaskId,
			values: { ...wireTask(subtaskId, owner.id, 'Guest subtask'), parent_id: sharedId },
		},
	]),
	'guest put of a subtask under the shared task',
);
check(result.rejected.length === 0, 'guest subtask admitted into the owner space');
check(
	await waitFor(otherStream, 'tasks', subtaskId, 'PUT', row => row.created_by === other.id),
	'the subtask streams to the guest, created_by the guest',
);

const hiddenId = crypto.randomUUID();
result = await json(
	await upload([{ op: 'put', table: 'tasks', id: hiddenId, values: wireTask(hiddenId, owner.id, 'Private') }]),
	'owner put of a private task',
);
result = await json(
	await uploadAs(other, [{ op: 'patch', table: 'tasks', id: hiddenId, values: { title: 'nope' } }]),
	'guest patch of a private task',
);
check(
	result.rejected.length === 1 && result.rejected[0]!.reason === 'Not editable in this share',
	`guest patch of a private task refused: ${JSON.stringify(result.rejected)}`,
);

// The `shared` stream opens only rows of the access owner's space. A forged access row naming a third user's task,
// which an upload bug once could produce, reaches the guest as an access row and streams no task with it.
if (databaseUrl) {
	const victim = await signUp('victim');
	const victimTask = crypto.randomUUID();
	result = await json(
		await uploadAs(victim, [
			{ op: 'put', table: 'tasks', id: victimTask, values: wireTask(victimTask, victim.id, 'Victim task') },
		]),
		'victim put of a private task',
	);
	check(result.rejected.length === 0, 'victim task put accepted');
	const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
	const db = drizzle(sql);
	const forgedId = `${other.id}:task:${victimTask}`;
	await db
		.insert(access)
		.values({ id: forgedId, grantee: other.id, owner: owner.id, kind: 'task', entityId: victimTask, role: 'edit' });
	try {
		check(
			await waitFor(otherStream, 'access', forgedId, 'PUT'),
			'the forged access row itself streams to the guest, so its checkpoint has been applied',
		);
		check(
			!otherStream.seen(rowLine('tasks', victimTask, 'PUT')),
			'the forged access row opens no task outside the access owner’s space',
		);
	} finally {
		await db.delete(access).where(eq(access.id, forgedId));
		await sql.end();
	}
	check(
		await waitFor(otherStream, 'access', forgedId, 'REMOVE'),
		'the forged access row is gone again from the guest stream',
	);
} else {
	console.log('skip forged access row check: no database URL (pass --database or run from a worktree)');
}

const revoked = await fetch(`${api}/api/shares?id=${share.id}`, { method: 'DELETE', headers: owner.headers });
check(revoked.ok, 'owner revoked the share');
// Each shared row is its own bucket, so a revoke drops buckets rather than sending REMOVE ops.
check(
	await otherStream.until(line => 'checkpoint_diff' in line && line.checkpoint_diff.removed_buckets.length > 0, 15_000),
	'the revoke removes the shared buckets from the guest stream',
);

console.log(`\nSync smoke passed in ${Math.round(performance.now() - started)} ms against ${api}`);
process.exit(0);
