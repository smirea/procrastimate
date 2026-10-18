import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import { images, tasks } from '../../shared/db/schema';
import { IMAGE_LIMITS, IMAGES_PATH, imageSizeSchema, imageTypeSchema, sniffImageType } from '../../shared/images';
import { readActor, spaceOf } from './actor';
import type { App } from './app';
import type { Db } from './db/postgres';
import { errorResponse } from './errors';
import { identify } from './sentry';
import { accessIn, seenBy, sightOf, type Sight } from './space';

/**
 * Image bytes, apart from sync. A task lists its images' ids in its synced `images` field; the bytes sit in the
 * `images` table, outside the PowerSync publication, written and read one row at a time. See
 * `docs/decisions/images.md`.
 */

export const isImageRoute = (request: Request) => new URL(request.url).pathname === IMAGES_PATH;

/**
 * How long bytes outlive the last task that listed them. Long enough for undo, a device that deleted a task offline
 * and then restored it, and an upload whose write has not synced yet, which reaches the server first.
 */
export const IMAGE_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * The daily cron's sweep over every user: reads which images exist and which a live task lists, two queries, then
 * marks the unlisted, clears the mark of the listed again, and drops what stayed unlisted past the grace period.
 * Nothing on the write path reads the `images` table.
 */
export async function sweepImages(db: Db, now: number): Promise<void> {
	const [states, listed] = await Promise.all([
		db.select({ userId: images.userId, id: images.id, orphanedAt: images.orphanedAt }).from(images),
		db
			.select({ userId: tasks.userId, images: tasks.images })
			.from(tasks)
			.where(sql`jsonb_array_length(${tasks.images}) > 0`),
	]);
	const referenced = new Set(listed.flatMap(row => row.images.map(image => `${row.userId}:${image.id}`)));
	for (const [owner, rows] of Map.groupBy(states, row => row.userId)) {
		const mark: string[] = [];
		const unmark: string[] = [];
		const drop: string[] = [];
		for (const { id, orphanedAt } of rows) {
			if (referenced.has(`${owner}:${id}`)) {
				if (orphanedAt !== null) unmark.push(id);
			} else if (orphanedAt === null) mark.push(id);
			else if (orphanedAt <= now - IMAGE_GRACE_MS) drop.push(id);
		}
		const own = eq(images.userId, owner);
		if (mark.length)
			await db
				.update(images)
				.set({ orphanedAt: now })
				.where(and(own, inArray(images.id, mark)));
		if (unmark.length)
			await db
				.update(images)
				.set({ orphanedAt: null })
				.where(and(own, inArray(images.id, unmark)));
		if (drop.length) await db.delete(images).where(and(own, inArray(images.id, drop)));
	}
}

const IMAGE_ID = /^[A-Za-z0-9_-]{8,80}$/;

/**
 * `GET` answers the bytes, cached for good since an id's bytes never change; `PUT` stores the raw body. The owner reads
 * every image the space stored, anyone else the ones a task they see lists, checked in the same select as the bytes.
 * A guest uploads with any edit share: an upload reaches the server before the write that lists it, often for a task
 * the server has not seen yet, so it cannot be tied to one; the write itself is still checked.
 */
export async function imagesRoute(request: Request, app: App): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'PUT') return errorResponse('NOT_FOUND', 'Not found');
	const actor = await readActor(request, app);
	if (!actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
	if (request.method === 'PUT' && actor.kind !== 'human') return errorResponse('FORBIDDEN', 'Not for AI accounts');
	identify(actor);
	const { db } = app;
	const query = new URL(request.url).searchParams;
	const owner = spaceOf(actor, query.get('space'));
	let sight: Sight | null = null;
	let write = true;
	if (actor.kind !== 'human' || actor.id !== owner) {
		const access = await accessIn(db, owner, actor);
		if (access?.role !== 'guest') return errorResponse('FORBIDDEN', 'Not shared with you');
		sight = await sightOf(db, owner, actor, access);
		write = access.shares.some(share => share.role === 'edit');
	}
	const id = query.get('id') ?? '';
	const size = imageSizeSchema.safeParse(query.get('size'));
	if (!IMAGE_ID.test(id) || !size.success) return errorResponse('BAD_REQUEST', 'Needs an image id and size');
	if (request.method === 'GET') {
		const listed = sight
			? exists(
					db
						.select({ one: sql`1` })
						.from(tasks)
						.where(
							and(
								eq(tasks.userId, owner),
								sql`${tasks.images} @> ${JSON.stringify([{ id }])}::jsonb`,
								seenBy(db, sight, owner, tasks.id),
							),
						),
				)
			: undefined;
		const [image] = await db
			.select({ type: images.type, bytes: images.bytes })
			.from(images)
			.where(and(eq(images.userId, owner), eq(images.id, id), eq(images.size, size.data), listed));
		if (!image) return errorResponse('NOT_FOUND', 'No such image');
		return new Response(image.bytes, {
			headers: {
				'Content-Type': image.type,
				'Content-Length': String(image.bytes.byteLength),
				'Cache-Control': 'private, max-age=31536000, immutable',
			},
		});
	}
	if (!write) return errorResponse('FORBIDDEN', 'Not yours to edit');
	const limit = IMAGE_LIMITS[size.data].bytes;
	if (Number(request.headers.get('content-length') ?? 0) > limit) {
		return errorResponse('PAYLOAD_TOO_LARGE', `An image is at most ${limit} bytes`);
	}
	const type = imageTypeSchema.safeParse(request.headers.get('content-type'));
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.byteLength > limit) return errorResponse('PAYLOAD_TOO_LARGE', `An image is at most ${limit} bytes`);
	if (!type.success || sniffImageType(bytes) !== type.data) {
		return errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Images are WebP or JPEG');
	}
	// Ids are client-made UUIDs and an id's bytes never change, so a put for an existing id is a retry and keeps them.
	await db
		.insert(images)
		.values({ userId: owner, id, size: size.data, type: type.data, bytes, createdAt: Date.now(), orphanedAt: null })
		.onConflictDoNothing();
	return Response.json({ ok: true });
}
