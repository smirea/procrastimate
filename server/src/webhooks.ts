import { ORPCError } from '@orpc/server';
import { and, asc, eq, gt, inArray, isNull, lte, max, ne } from 'drizzle-orm';
import { comments, log, projects, tasks, webhooks } from '../../shared/db/schema';
import { newId } from '../../shared/id';
import {
	WEBHOOK_SIGNATURE_HEADER,
	WEBHOOK_SIGNATURE_PREFIX,
	type CreatedWebhook,
	type NewWebhook,
	type Webhook,
	type WebhookDelivery,
	type WebhookEvent,
} from '../../shared/webhooks';
import { requireAccess, requireManager, type Command } from './commands';
import { user } from './db/auth-schema';
import type { Db } from './db/sqlite';
import { reportError } from './sentry';

/**
 * Webhooks read the `log` as their outbox. Each hook keeps a cursor into it, and the minute cron sends one POST per hook
 * with the tasks and comments humans added after the cursor, then moves the cursor only when the receiver answers 2xx.
 * Nothing is written on the write path, so a slow or dead receiver can never hold up a sync.
 */

/** Sends one signed body and returns the receiver's status, or null when it never answered. */
export type SendWebhook = (url: string, body: string, headers: Record<string, string>) => Promise<number | null>;

const SEND_TIMEOUT_MS = 10_000;
/** A day of failures disables a hook, so a receiver that is gone for good stops costing a request a minute. */
export const DISABLE_AFTER_MS = 24 * 60 * 60_000;
/** Log rows read per hook per run; a longer backlog drains over the next runs. */
const SCAN_LIMIT = 500;
const MAX_PROJECTS = 50;

type WebhookRow = typeof webhooks.$inferSelect;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function checkedUrl(raw: string): string {
	const url = new URL(raw);
	if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return url.href;
	throw new ORPCError('BAD_REQUEST', { message: 'A webhook URL must be HTTPS, or HTTP to a loopback address' });
}

const publicOf = ({ userId: _, secret: __, retryThrough: ___, ...hook }: WebhookRow): Webhook => hook;

const head = (db: Db) =>
	db
		.select({ seq: max(log.seq) })
		.from(log)
		.get()?.seq ?? 0;

function managed({ db, owner, actor }: Command) {
	requireManager(requireAccess(db, owner, actor));
}

export function listWebhooks(command: Command): Webhook[] {
	managed(command);
	return command.db.select().from(webhooks).where(eq(webhooks.userId, command.owner)).all().map(publicOf);
}

/** Registering a URL again keeps its id and secret; a disabled hook restarts from now rather than replaying a backlog. */
export function createWebhook(command: Command, input: NewWebhook): CreatedWebhook {
	managed(command);
	const { db, owner, actor, now } = command;
	const url = checkedUrl(input.url);
	const projectIds = [...new Set(input.projectIds ?? [])];
	// Each id is a bound parameter, and a Durable Object binds at most 100 per statement.
	if (projectIds.length > MAX_PROJECTS)
		throw new ORPCError('BAD_REQUEST', { message: `A webhook watches at most ${MAX_PROJECTS} projects` });
	if (projectIds.length) {
		const found = db
			.select({ id: projects.id })
			.from(projects)
			.where(and(eq(projects.userId, owner), inArray(projects.id, projectIds)))
			.all();
		const missing = projectIds.filter(id => !found.some(project => project.id === id));
		if (missing.length) throw new ORPCError('NOT_FOUND', { message: `No such project: ${missing.join(', ')}` });
	}
	const existing = db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.userId, owner), eq(webhooks.url, url)))
		.get();
	const restart = !existing || existing.disabledAt !== null;
	const row: WebhookRow = {
		userId: owner,
		id: existing?.id ?? newId(),
		url,
		secret: existing?.secret ?? randomSecret(),
		projectIds,
		createdBy: existing?.createdBy ?? actor.id,
		createdAt: existing?.createdAt ?? now,
		cursor: restart ? head(db) : existing.cursor,
		retryThrough: restart ? null : existing.retryThrough,
		deliveredAt: existing?.deliveredAt ?? null,
		failingSince: restart ? null : existing.failingSince,
		lastError: restart ? null : existing.lastError,
		disabledAt: null,
	};
	const { userId: _, id: __, ...set } = row;
	db.insert(webhooks)
		.values(row)
		.onConflictDoUpdate({ target: [webhooks.userId, webhooks.id], set })
		.run();
	return { ...publicOf(row), secret: row.secret };
}

export function deleteWebhook(command: Command, id: string): void {
	managed(command);
	const where = and(eq(webhooks.userId, command.owner), eq(webhooks.id, id));
	if (!command.db.select({ id: webhooks.id }).from(webhooks).where(where).get())
		throw new ORPCError('NOT_FOUND', { message: 'No such webhook' });
	command.db.delete(webhooks).where(where).run();
}

function randomSecret(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

const firstSeq = (db: Db, kind: 'task' | 'comment', id: string) =>
	db
		.select({ seq: log.seq })
		.from(log)
		.where(and(eq(log.kind, kind), eq(log.id, id)))
		.orderBy(asc(log.seq))
		.limit(1)
		.get()?.seq;

/**
 * What humans added in `hook`'s space after its cursor, up to `through`: a task created, or moved into a watched
 * project, and a comment created. Each is judged by the task as it is now, so a task deleted since, or moved out of
 * the watched projects, is left out. `next` is where the cursor moves once these are delivered.
 */
function pendingEvents(db: Db, hook: WebhookRow, through: number): { events: WebhookEvent[]; next: number } {
	const rows = db
		.select({ seq: log.seq, kind: log.kind, id: log.id, op: log.op, fields: log.fields, actor: log.actor, at: log.at })
		.from(log)
		.innerJoin(user, eq(user.id, log.actor))
		.where(
			and(
				eq(log.userId, hook.userId),
				gt(log.seq, hook.cursor),
				lte(log.seq, through),
				eq(user.kind, 'human'),
				inArray(log.kind, ['task', 'comment']),
				ne(log.op, 'delete'),
			),
		)
		.orderBy(asc(log.seq))
		.limit(SCAN_LIMIT)
		.all();
	const next = rows.length < SCAN_LIMIT ? through : rows.at(-1)!.seq;
	const watched = new Set(hook.projectIds);
	const events = new Map<string, WebhookEvent>();
	for (const row of rows) {
		const moved = row.kind === 'task' && row.op === 'patch' && watched.size > 0 && 'projectId' in row.fields;
		const created = row.op === 'put' && firstSeq(db, row.kind as 'task' | 'comment', row.id) === row.seq;
		if (!moved && !created) continue;
		const taskId = row.kind === 'task' ? row.id : String(row.fields.taskId);
		const task = db
			.select({ projectId: tasks.projectId, parentId: tasks.parentId })
			.from(tasks)
			.where(and(eq(tasks.userId, hook.userId), eq(tasks.id, taskId)))
			.get();
		if (!task || (watched.size && !watched.has(task.projectId ?? ''))) continue;
		// Subtasks follow their root's project, so a moved tree is one addition, its root.
		if (moved && !created && task.parentId !== null) continue;
		if (row.kind === 'comment' && !db.select({ id: comments.id }).from(comments).where(eq(comments.id, row.id)).get())
			continue;
		const type = row.kind === 'task' ? 'task.added' : 'comment.added';
		const key = `${type}:${row.id}`;
		if (events.has(key)) continue;
		events.set(key, {
			type,
			taskId,
			commentId: row.kind === 'comment' ? row.id : null,
			projectId: task.projectId,
			actorId: row.actor,
			at: row.at,
		});
	}
	return { events: [...events.values()], next };
}

function summaryOf(events: readonly WebhookEvent[]): string {
	const count = (type: WebhookEvent['type'], noun: string) => {
		const n = events.filter(event => event.type === type).length;
		return n ? `${n} ${noun}${n === 1 ? '' : 's'} added` : null;
	};
	return [count('task.added', 'task'), count('comment.added', 'comment')].filter(Boolean).join(', ');
}

async function hmacHex(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);
	const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
	return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export const fetchWebhook: SendWebhook = async (url, body, headers) => {
	try {
		const response = await fetch(url, {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', 'user-agent': 'ProcrastiMate-Webhook', ...headers },
			redirect: 'manual',
			signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
		});
		await response.body?.cancel();
		return response.status;
	} catch {
		return null;
	}
};

/**
 * The cron, every minute: each enabled hook with something new gets one POST. The sends await the network, so other
 * requests run meanwhile: each hook is read again just before its send, and its settle is keyed by the cursor it read,
 * so a hook deleted, registered again, or refiltered while an earlier send was in flight is sent as it is now.
 */
export async function deliverWebhooks(db: Db, now: number, send: SendWebhook): Promise<number> {
	const ids = db
		.select({ userId: webhooks.userId, id: webhooks.id })
		.from(webhooks)
		.where(isNull(webhooks.disabledAt))
		.all();
	let delivered = 0;
	for (const { userId, id } of ids) {
		try {
			delivered += await deliverTo(db, userId, id, now, send);
		} catch (error) {
			reportError(error);
		}
	}
	return delivered;
}

async function deliverTo(db: Db, owner: string, id: string, now: number, send: SendWebhook): Promise<number> {
	const hook = db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.userId, owner), eq(webhooks.id, id), isNull(webhooks.disabledAt)))
		.get();
	if (!hook) return 0;
	// A retry keeps the failed delivery's range, so a receiver that got it but failed to answer sees the same `id`.
	const through = hook.retryThrough ?? head(db);
	if (hook.cursor >= through) return 0;
	const { events, next } = pendingEvents(db, hook, through);
	const where = and(eq(webhooks.userId, owner), eq(webhooks.id, id), eq(webhooks.cursor, hook.cursor));
	const settled = { cursor: next, retryThrough: null, failingSince: null, lastError: null };
	if (!events.length) {
		db.update(webhooks).set(settled).where(where).run();
		return 0;
	}
	const delivery: WebhookDelivery = {
		id: `${hook.id}:${next}`,
		webhookId: hook.id,
		space: hook.userId,
		summary: summaryOf(events),
		events,
	};
	const body = JSON.stringify(delivery);
	const signature = `${WEBHOOK_SIGNATURE_PREFIX}${await hmacHex(hook.secret, body)}`;
	const status = await send(hook.url, body, { [WEBHOOK_SIGNATURE_HEADER]: signature });
	if (status !== null && status >= 200 && status < 300) {
		db.update(webhooks)
			.set({ ...settled, deliveredAt: now })
			.where(where)
			.run();
		return 1;
	}
	const failingSince = hook.failingSince ?? now;
	const gone = status === 404 || status === 410;
	db.update(webhooks)
		.set({
			retryThrough: through,
			failingSince,
			lastError: status === null ? 'No answer' : `HTTP ${status}`,
			disabledAt: gone || now - failingSince >= DISABLE_AFTER_MS ? now : null,
		})
		.where(where)
		.run();
	return 0;
}
