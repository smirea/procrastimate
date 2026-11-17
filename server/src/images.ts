import type { R2Bucket } from '@cloudflare/workers-types';
import { and, eq, sql } from 'drizzle-orm';
import { orphans, tasks } from '../../shared/db/schema';
import { byteKeySchema, type ByteKey } from '../../shared/images';
import { readActor, spaceOf } from './actor';
import type { App } from './app';
import type { Db } from './db/sqlite';
import { errorResponse } from './errors';
import { imagesRoute, type Grant } from './image-bytes';
import { identify } from './sentry';
import { accessIn, seenBy, sightOf } from './space';

/**
 * Who may read and write attachment bytes, and which bytes are garbage: the half of attachments that needs the
 * database. The bytes themselves sit in the bucket, which `image-bytes.ts` reads and writes once this has granted the
 * request. See `docs/decisions/images.md`.
 */

/**
 * How long bytes outlive the last task that listed them. Long enough for undo, a device that deleted a task offline
 * and then restored it, and an upload whose write has not synced yet, which reaches the server first.
 */
export const IMAGE_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

const IMAGE_ID = /^[A-Za-z0-9_-]{8,80}$/;

export const objectKey = (owner: string, id: string, size: ByteKey) => `${owner}/${id}/${size}`;

/**
 * Grants a request for attachment bytes, or answers why not. The owner reads every object the space stored, anyone
 * else the ones a task they see lists. Only humans write, a guest with any edit share: an upload reaches the server
 * before the write that lists it, often for a task the server has not seen yet, so it cannot be tied to one; the write
 * itself is still checked.
 */
export async function authorizeImages(request: Request, app: App): Promise<Grant | Response> {
	const reads = request.method === 'GET' || request.method === 'HEAD';
	if (!reads && request.method !== 'PUT' && request.method !== 'POST') return errorResponse('NOT_FOUND', 'Not found');
	const actor = await readActor(request, app);
	if (!actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
	if (!reads && actor.kind !== 'human') return errorResponse('FORBIDDEN', 'Not for AI accounts');
	identify(actor);
	const { db } = app;
	const query = new URL(request.url).searchParams;
	const id = query.get('id') ?? '';
	const size = byteKeySchema.safeParse(query.get('size'));
	if (!IMAGE_ID.test(id) || !size.success) return errorResponse('BAD_REQUEST', 'Needs an attachment id and size');
	const owner = spaceOf(actor, query.get('space'));
	const grant = { key: objectKey(owner, id, size.data) };
	if (actor.kind === 'human' && actor.id === owner) return grant;
	const access = accessIn(db, owner, actor);
	if (access?.role !== 'guest') return errorResponse('FORBIDDEN', 'Not shared with you');
	if (!reads) {
		return access.shares.some(share => share.role === 'edit') ? grant : errorResponse('FORBIDDEN', 'Not yours to edit');
	}
	const listed = db
		.select({ id: tasks.id })
		.from(tasks)
		.where(
			and(
				eq(tasks.userId, owner),
				seenBy(db, sightOf(actor, access), owner, tasks.id),
				sql`EXISTS (SELECT 1 FROM json_each(${tasks.attachments}) AS listed WHERE json_extract(listed.value, '$.id') = ${id})`,
			),
		)
		.limit(1)
		.get();
	return listed ? grant : errorResponse('NOT_FOUND', 'No such attachment');
}

/** Both halves in one process, as the Bun server and the tests run them. */
export const localImages = (request: Request, app: App, bucket: R2Bucket) =>
	imagesRoute(request, bucket, () => authorizeImages(request, app));

/**
 * The daily cron's sweep over every user: lists the bucket, reads which attachments a live task lists, then marks the
 * unlisted in `orphans`, clears the mark of the listed again, and deletes what stayed unlisted past the grace period.
 * Nothing on the upload path writes to the database, so the bucket's listing is what exists.
 */
export async function sweepImages(db: Db, bucket: R2Bucket, now: number): Promise<void> {
	const stored = new Map<string, string[]>();
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ cursor });
		for (const { key } of page.objects) {
			const ref = key.slice(0, key.lastIndexOf('/'));
			stored.set(ref, [...(stored.get(ref) ?? []), key]);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);

	const referenced = new Set(
		db
			.select({ userId: tasks.userId, attachments: tasks.attachments })
			.from(tasks)
			.where(sql`json_array_length(${tasks.attachments}) > 0`)
			.all()
			.flatMap(row => row.attachments.map(item => `${row.userId}/${item.id}`)),
	);
	const marks = new Map(
		db
			.select()
			.from(orphans)
			.all()
			.map(row => [`${row.userId}/${row.id}`, row.orphanedAt]),
	);
	const unmark = (ref: string) => {
		const [userId, id] = ref.split('/') as [string, string];
		db.delete(orphans)
			.where(and(eq(orphans.userId, userId), eq(orphans.id, id)))
			.run();
	};
	const drop: string[] = [];
	for (const ref of stored.keys()) {
		const mark = marks.get(ref);
		if (referenced.has(ref)) {
			if (mark !== undefined) unmark(ref);
		} else if (mark === undefined) {
			const [userId, id] = ref.split('/') as [string, string];
			db.insert(orphans).values({ userId, id, orphanedAt: now }).run();
		} else if (mark <= now - IMAGE_GRACE_MS) drop.push(ref);
	}
	for (const ref of marks.keys()) if (!stored.has(ref)) unmark(ref);

	const keys = drop.flatMap(ref => stored.get(ref)!);
	for (let from = 0; from < keys.length; from += 1000) await bucket.delete(keys.slice(from, from + 1000));
	for (const ref of drop) unmark(ref);
}
