import { and, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import { images, tasks, type ImageRow } from '../../shared/db/schema';
import {
	IMAGE_LIMITS,
	IMAGES_PATH,
	imageSizeSchema,
	imageTypeSchema,
	sniffImageType,
	type ImageSize,
	type ImageType,
} from '../../shared/images';
import type { Task } from '../../shared/model';
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

export type StoredImage = { type: ImageType; bytes: Uint8Array<ArrayBuffer> };
type ImageState = Pick<ImageRow, 'id' | 'orphanedAt'>;

/** Ids are client-made UUIDs and an id's bytes never change, so a put for an existing id is a retry and keeps what is stored. */
export async function putImage(db: Db, owner: string, id: string, size: ImageSize, image: StoredImage, now: number) {
	await db
		.insert(images)
		.values({ userId: owner, id, size, type: image.type, bytes: image.bytes, createdAt: now, orphanedAt: null })
		.onConflictDoNothing();
}

/**
 * Which of the space's images a caller reads: the owner every one stored, anyone else the ones a task they see lists,
 * checked in the same select as the bytes.
 */
export type ImageReader = { kind: 'owner' } | { kind: 'guest'; sight: Sight };

export async function getImage(
	db: Db,
	owner: string,
	id: string,
	size: ImageSize,
	reader: ImageReader,
): Promise<StoredImage | null> {
	const listed =
		reader.kind === 'guest'
			? exists(
					db
						.select({ one: sql`1` })
						.from(tasks)
						.where(
							and(
								eq(tasks.userId, owner),
								sql`${tasks.images} @> ${JSON.stringify([{ id }])}::jsonb`,
								seenBy(db, reader.sight, owner, tasks.id),
							),
						),
				)
			: undefined;
	const [row] = await db
		.select({ type: images.type, bytes: images.bytes })
		.from(images)
		.where(and(eq(images.userId, owner), eq(images.id, id), eq(images.size, size), listed));
	return row ?? null;
}

/**
 * How long bytes outlive the last task that listed them. Long enough for undo, a device that deleted a task offline
 * and then restored it, and an upload whose write has not synced yet, which reaches the server first.
 */
export const IMAGE_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

export type SweepPlan = { mark: string[]; unmark: string[]; drop: string[]; now: number };

export const imageIds = (tasks: readonly Pick<Task, 'images'>[]) =>
	new Set(tasks.flatMap(task => task.images.map(image => image.id)));

export function sweepPlan(referenced: ReadonlySet<string>, states: readonly ImageState[], now: number): SweepPlan {
	const mark = new Set<string>();
	const unmark = new Set<string>();
	const drop = new Set<string>();
	for (const { id, orphanedAt } of states) {
		if (referenced.has(id)) {
			if (orphanedAt !== null) unmark.add(id);
		} else if (orphanedAt === null) mark.add(id);
		else if (orphanedAt <= now - IMAGE_GRACE_MS) drop.add(id);
	}
	return { mark: [...mark], unmark: [...unmark], drop: [...drop], now };
}

export async function applySweep(db: Db, owner: string, { mark, unmark, drop, now }: SweepPlan): Promise<void> {
	const own = eq(images.userId, owner);
	if (mark.length) {
		await db
			.update(images)
			.set({ orphanedAt: now })
			.where(and(own, inArray(images.id, mark), isNull(images.orphanedAt)));
	}
	if (unmark.length)
		await db
			.update(images)
			.set({ orphanedAt: null })
			.where(and(own, inArray(images.id, unmark)));
	if (drop.length) await db.delete(images).where(and(own, inArray(images.id, drop)));
}

/**
 * The daily cron's sweep over every user: reads which images exist and which a live task lists, two queries, then
 * marks, unmarks, and drops per user. Nothing on the write path reads the `images` table.
 */
export async function sweepImages(db: Db, now: number): Promise<void> {
	const [states, listed] = await Promise.all([
		db.select({ userId: images.userId, id: images.id, orphanedAt: images.orphanedAt }).from(images),
		db
			.select({ userId: tasks.userId, images: tasks.images })
			.from(tasks)
			.where(sql`jsonb_array_length(${tasks.images}) > 0`),
	]);
	const referenced = Map.groupBy(listed, row => row.userId);
	for (const [owner, rows] of Map.groupBy(states, row => row.userId)) {
		await applySweep(db, owner, sweepPlan(imageIds(referenced.get(owner) ?? []), rows, now));
	}
}

/**
 * A guest uploads with any edit share. An upload reaches the server before the write that lists it, often for a task
 * the server has not seen yet, so it cannot be tied to one; the write itself is still checked.
 */
export type ImageAccess = { read: ImageReader; write: boolean };

export const OWNER_ACCESS: ImageAccess = { read: { kind: 'owner' }, write: true };

const IMAGE_ID = /^[A-Za-z0-9_-]{8,80}$/;

/** `GET` answers the bytes, cached for good since an id's bytes never change; `PUT` stores the raw body. */
export async function imageResponse(
	request: Request,
	db: Db,
	owner: string,
	access: ImageAccess,
	now: number,
): Promise<Response> {
	const query = new URL(request.url).searchParams;
	const id = query.get('id') ?? '';
	const size = imageSizeSchema.safeParse(query.get('size'));
	if (!IMAGE_ID.test(id) || !size.success) return errorResponse('BAD_REQUEST', 'Needs an image id and size');
	if (request.method === 'GET') {
		const image = await getImage(db, owner, id, size.data, access.read);
		if (!image) return errorResponse('NOT_FOUND', 'No such image');
		return new Response(image.bytes, {
			headers: {
				'Content-Type': image.type,
				'Content-Length': String(image.bytes.byteLength),
				'Cache-Control': 'private, max-age=31536000, immutable',
			},
		});
	}
	if (!access.write) return errorResponse('FORBIDDEN', 'Not yours to edit');
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
	await putImage(db, owner, id, size.data, { type: type.data, bytes }, now);
	return Response.json({ ok: true });
}

export async function imagesRoute(request: Request, app: App): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'PUT') return errorResponse('NOT_FOUND', 'Not found');
	const actor = await readActor(request, app);
	if (!actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
	if (request.method === 'PUT' && actor.kind !== 'human') return errorResponse('FORBIDDEN', 'Not for AI accounts');
	identify(actor);
	const now = Date.now();
	const owner = spaceOf(actor, new URL(request.url).searchParams.get('space'));
	if (actor.kind === 'human' && actor.id === owner) return imageResponse(request, app.db, owner, OWNER_ACCESS, now);
	const access = await accessIn(app.db, owner, actor);
	if (access?.role !== 'guest') return errorResponse('FORBIDDEN', 'Not shared with you');
	const sight = await sightOf(app.db, owner, actor, access);
	const write = access.shares.some(share => share.role === 'edit');
	return imageResponse(request, app.db, owner, { read: { kind: 'guest', sight }, write }, now);
}
