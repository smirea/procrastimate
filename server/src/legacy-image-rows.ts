import type { R2Bucket } from '@cloudflare/workers-types';
import { and, eq, sql } from 'drizzle-orm';
import { customType, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tasks } from '../../shared/db/schema';
import { isImage } from '../../shared/values';
import { dumpJson } from './db/backup';
import type { Db } from './db/sqlite';
import { fileMetadata, imageMetadata } from './image-bytes';
import { objectKey } from './images';

/**
 * The one move of attachment bytes out of the database into the bucket. Until this ran, the `images` table held them:
 * one row per size of an image and one per 1.5 MB part of a file. The `App` object runs a batch of it beside every
 * request until the table is gone, since the free plan allows a request about 50 calls to the bucket. Delete this
 * file once production has run it.
 */

const bytes = customType<{ data: Uint8Array<ArrayBuffer>; driverData: Uint8Array | ArrayBuffer }>({
	dataType: () => 'blob',
	fromDriver: value =>
		value instanceof ArrayBuffer
			? new Uint8Array(value)
			: new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength),
});

/** Not in `shared/db/schema.ts`, so the migrator never creates it and the daily dump never reads it. */
const images = sqliteTable('images', {
	userId: text('user_id').notNull(),
	id: text('id').notNull(),
	size: text('size').notNull(),
	type: text('type').notNull(),
	bytes: bytes('bytes').notNull(),
	createdAt: integer('created_at').notNull(),
});

/** Where the last backup that holds attachment bytes sits in the backups bucket, outside the prefix the daily prune reads. */
export const FINAL_BACKUP = 'before-attachments-in-r2';

const partOf = (size: string) => Number(size.match(/^part(\d+)$/)?.[1] ?? NaN);

/** How many objects one batch writes. A 25 MB file is 17 parts and one object, so every attachment fits a batch. */
const BATCH_WRITES = 40;

/**
 * One batch: writes the database dump to `FINAL_BACKUP` once, then for as many attachments as fit, copies their
 * `images` rows there, stores them in the bucket, an image's sizes as they are and a file's parts joined, and deletes
 * the rows. Drops the table when it is empty. A file some of whose parts never arrived is left out of the bucket,
 * since it could not be opened before either; its parts stay in the backup. Answers null once there is no table.
 */
export async function moveLegacyImages(
	db: Db,
	attachments: R2Bucket,
	backups: R2Bucket,
	now: Date,
	batch = BATCH_WRITES,
): Promise<string | null> {
	if (!db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'images'`)) return null;
	let writes = 0;
	if (!(await backups.head(`${FINAL_BACKUP}/database.json`))) {
		await backups.put(`${FINAL_BACKUP}/database.json`, dumpJson(db, now), {
			httpMetadata: { contentType: 'application/json' },
		});
	}
	const rows = db
		.select({ userId: images.userId, id: images.id, size: images.size, type: images.type })
		.from(images)
		.all();
	let moved = 0;
	let skipped = 0;
	const groups = [...Map.groupBy(rows, row => `${row.userId}/${row.id}`).values()];
	const said = () =>
		`Moved ${moved} attachments from the database to the bucket, ${groups.length - moved} to go` +
		(skipped ? `; ${skipped} unfinished files left in the backup` : '');
	for (const group of groups) {
		writes += group.length * 2;
		if (moved && writes > batch) return said();
		const { userId, id } = group[0]!;
		const own = and(eq(images.userId, userId), eq(images.id, id));
		const read = (size: string) =>
			db
				.select({ bytes: images.bytes })
				.from(images)
				.where(and(own, eq(images.size, size)))
				.get()!.bytes;
		const parts: Uint8Array<ArrayBuffer>[] = [];
		for (const { size, type } of group.toSorted((a, b) => partOf(a.size) - partOf(b.size))) {
			const data = read(size);
			await backups.put(`${FINAL_BACKUP}/images/${userId}/${id}/${size}`, data, {
				httpMetadata: { contentType: type },
			});
			if (Number.isNaN(partOf(size))) {
				await attachments.put(objectKey(userId, id, size as 'full' | 'thumb'), data, {
					httpMetadata: imageMetadata(type),
				});
			} else parts.push(data);
		}
		if (parts.length) {
			const listed = db
				.select({ attachments: tasks.attachments })
				.from(tasks)
				.where(
					and(
						eq(tasks.userId, userId),
						sql`EXISTS (SELECT 1 FROM json_each(${tasks.attachments}) AS listed WHERE json_extract(listed.value, '$.id') = ${id})`,
					),
				)
				.get();
			const file = listed?.attachments.find(attachment => attachment.id === id);
			const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
			if (file && !isImage(file) && file.bytes !== length) skipped++;
			else {
				await attachments.put(objectKey(userId, id, 'file'), new Blob(parts) as never, {
					httpMetadata: fileMetadata(file && !isImage(file) ? file : { name: '', type: '' }),
				});
			}
		}
		db.delete(images).where(own).run();
		moved++;
	}
	db.run(sql`DROP TABLE images`);
	return said();
}
