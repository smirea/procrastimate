import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { images, type ImageRow, type ShareRow } from '../../../shared/db/schema';
import {
	IMAGE_LIMITS,
	IMAGES_PATH,
	imageSizeSchema,
	imageTypeSchema,
	sniffImageType,
	type ImageSize,
	type ImageType,
} from '../../../shared/images';
import { scopeOf } from '../../../shared/scope';
import type { Snapshot } from '../../../shared/sync/protocol';
import { errorResponse } from '../errors';

/**
 * Image bytes, apart from the account. A task lists its images' ids in its synced `images` field; the bytes sit in
 * the `images` table, written and read one row at a time, so the per-request account load never carries them and a
 * thumbnail never costs a load. See `docs/decisions/images.md`.
 */

/** Reading is `agentContract.images.get`; uploading takes raw bytes, so it has no contract entry. */
export const IMAGE_UPLOAD_ROUTE = `PUT ${IMAGES_PATH}`;
export const isImageRoute = (request: Request) => new URL(request.url).pathname === IMAGES_PATH;

export type StoredImage = { type: ImageType; bytes: Uint8Array<ArrayBuffer> };
type ImageState = Pick<ImageRow, 'id' | 'orphanedAt'>;

/**
 * One space's image bytes. Ids are client-made UUIDs and an id's bytes never change, so a put for an existing id is a
 * retry and keeps what is stored: nobody can swap the bytes behind an id someone else can see.
 */
export interface ImageStore {
	put(id: string, size: ImageSize, image: StoredImage, now: number): Promise<void>;
	get(id: string, size: ImageSize): Promise<StoredImage | null>;
	/** Every row's id and orphan mark, without the bytes. */
	states(): Promise<ImageState[]>;
	/** Applies a `sweepPlan`: marks newly unlisted ids, clears the mark of listed ones, deletes the expired. */
	sweep(plan: SweepPlan): Promise<void>;
	clear(): Promise<void>;
}

/** Both the Durable Object's SQLite and Turso; Drizzle's sync drivers answer `await` too. */
type Database = BaseSQLiteDatabase<'sync' | 'async', unknown>;

/** Durable Object SQLite binds at most 100 parameters per query; the user id and the mark time take two. */
function batches(ids: readonly string[]): string[][] {
	const result: string[][] = [];
	for (let start = 0; start < ids.length; start += 90) result.push(ids.slice(start, start + 90));
	return result;
}

/** `open` is called per query: Turso connects and migrates asynchronously, and `tursoDatabase` already caches. */
export function databaseImages(open: () => Database | Promise<Database>, userId: string): ImageStore {
	const own = eq(images.userId, userId);
	const database = async () => open();
	return {
		async put(id, size, { type, bytes }, now) {
			const db = await database();
			await db
				.insert(images)
				.values({ userId, id, size, type, bytes, createdAt: now, orphanedAt: null })
				.onConflictDoNothing();
		},
		async get(id, size) {
			const db = await database();
			const [row] = await db
				.select({ type: images.type, bytes: images.bytes })
				.from(images)
				.where(and(own, eq(images.id, id), eq(images.size, size)));
			return row ?? null;
		},
		states: async () =>
			(await database()).select({ id: images.id, orphanedAt: images.orphanedAt }).from(images).where(own),
		async sweep({ mark, unmark, drop, now }) {
			const db = await database();
			for (const ids of batches(mark)) {
				await db
					.update(images)
					.set({ orphanedAt: now })
					.where(and(own, inArray(images.id, ids), isNull(images.orphanedAt)));
			}
			for (const ids of batches(unmark)) {
				await db
					.update(images)
					.set({ orphanedAt: null })
					.where(and(own, inArray(images.id, ids)));
			}
			for (const ids of batches(drop)) await db.delete(images).where(and(own, inArray(images.id, ids)));
		},
		async clear() {
			await (await database()).delete(images).where(own);
		},
	};
}

/** The Bun dev server's and the tests' images, lost on restart like the memory account. */
export function memoryImages(): ImageStore {
	const rows = new Map<string, StoredImage & { id: string; orphanedAt: number | null }>();
	const key = (id: string, size: ImageSize) => `${id}\u0000${size}`;
	const withId = (ids: string[]) => [...rows].filter(([, row]) => ids.includes(row.id));
	return {
		async put(id, size, image, _now) {
			if (!rows.has(key(id, size))) rows.set(key(id, size), { ...image, id, orphanedAt: null });
		},
		async get(id, size) {
			const row = rows.get(key(id, size));
			return row ? { type: row.type, bytes: row.bytes } : null;
		},
		states: async () => [...rows.values()].map(({ id, orphanedAt }) => ({ id, orphanedAt })),
		async sweep({ mark, unmark, drop, now }) {
			for (const [, row] of withId(mark)) row.orphanedAt ??= now;
			for (const [, row] of withId(unmark)) row.orphanedAt = null;
			for (const [rowKey] of withId(drop)) rows.delete(rowKey);
		},
		async clear() {
			rows.clear();
		},
	};
}

/**
 * How long bytes outlive the last task that listed them. Long enough for undo, a device that deleted a task offline
 * and then restored it, and an upload whose op has not synced yet, which reaches the server first.
 */
export const IMAGE_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

export type SweepPlan = { mark: string[]; unmark: string[]; drop: string[]; now: number };

/** The ids every live task lists. Tombstones list none, so a deleted task's images go after the grace period. */
export const referencedImages = (snapshot: Snapshot) =>
	new Set(snapshot.tasks.flatMap(task => task.images.map(image => image.id)));

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

/** Who may read which image and whether they may upload. */
export type ImageAccess = { read: (id: string) => boolean; write: boolean };

export const OWNER_ACCESS: ImageAccess = { read: () => true, write: true };

/**
 * A guest reads the images of the tasks it may see, as `scopeOf` decides from the owner's whole snapshot, and
 * uploads with any edit share. An upload reaches the server before the op that lists it, often for a task the server
 * has not seen yet, so it cannot be tied to one; the op itself still goes through `admit`.
 */
export function guestImageAccess(snapshot: Snapshot, shares: readonly ShareRow[]): ImageAccess {
	const scope = scopeOf(snapshot, shares);
	const visible = referencedImages({ ...snapshot, tasks: snapshot.tasks.filter(task => scope.tasks.has(task.id)) });
	return { read: id => visible.has(id), write: shares.some(share => share.role === 'edit') };
}

const IMAGE_ID = /^[A-Za-z0-9_-]{8,80}$/;

/** `GET` answers the bytes, cached for good since an id's bytes never change; `PUT` stores the raw body. */
export async function imageResponse(
	request: Request,
	store: ImageStore,
	access: ImageAccess,
	now: number,
): Promise<Response> {
	const query = new URL(request.url).searchParams;
	const id = query.get('id') ?? '';
	const size = imageSizeSchema.safeParse(query.get('size'));
	if (!IMAGE_ID.test(id) || !size.success) return errorResponse('BAD_REQUEST', 'Needs an image id and size');
	if (request.method === 'GET') {
		const image = access.read(id) ? await store.get(id, size.data) : null;
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
	await store.put(id, size.data, { type: type.data, bytes }, now);
	return Response.json({ ok: true });
}
