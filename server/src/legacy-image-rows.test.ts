import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { objectKey } from './images';
import { FINAL_BACKUP, moveLegacyImages } from './legacy-image-rows';
import { localBucket } from './local-bucket';
import { signUp, taskRow, testApp, upload } from './test-app';

test('the image rows move to the bucket in batches, a file joined from its parts, with a backup of both, once', async () => {
	const app = await testApp();
	const owner = await signUp(app, 'Owner');
	const user = owner.person.id;
	const [photo, lease, unfinished, taskId] = Array.from({ length: 4 }, () => crypto.randomUUID());
	await upload(app, owner, [
		{
			op: 'put',
			table: 'tasks',
			id: taskId,
			values: taskRow(taskId, user, 'Papers', {
				attachments: JSON.stringify([
					{ id: photo, width: 4, height: 3 },
					{ id: lease, name: 'lease.pdf', type: 'application/pdf', bytes: 5 },
					{ id: unfinished, name: 'clip.mp4', type: 'video/mp4', bytes: 9 },
				]),
			}),
		},
	]);
	app.db.run(
		sql`CREATE TABLE images (user_id text NOT NULL, id text NOT NULL, size text NOT NULL, type text NOT NULL, bytes blob NOT NULL, created_at integer NOT NULL, orphaned_at integer, PRIMARY KEY (user_id, id, size))`,
	);
	const row = (id: string, size: string, type: string, bytes: number[]) =>
		app.db.run(sql`INSERT INTO images VALUES (${user}, ${id}, ${size}, ${type}, ${new Uint8Array(bytes)}, 1, NULL)`);
	row(photo, 'full', 'image/jpeg', [1, 2]);
	row(photo, 'thumb', 'image/webp', [3]);
	row(lease, 'part1', 'application/octet-stream', [4, 5]);
	row(lease, 'part0', 'application/octet-stream', [1, 2, 3]);
	row(unfinished, 'part0', 'application/octet-stream', [7]);

	const [attachments, backups] = [localBucket(null), localBucket(null)];
	const batch = () => moveLegacyImages(app.db, attachments, backups, new Date('2026-11-16T00:00:00Z'), 6);
	expect(await batch()).toBe('Moved 1 attachments from the database to the bucket, 2 to go');
	expect(await batch()).toBe(
		'Moved 2 attachments from the database to the bucket, 0 to go; 1 unfinished files left in the backup',
	);

	const stored = async (key: string) => {
		const object = await attachments.get(key);
		return (
			object && [
				[...new Uint8Array(await new Response(object.body as never).arrayBuffer())],
				object.httpMetadata?.contentType,
			]
		);
	};
	expect(await stored(objectKey(user, photo, 'full'))).toEqual([[1, 2], 'image/jpeg']);
	expect(await stored(objectKey(user, photo, 'thumb'))).toEqual([[3], 'image/webp']);
	expect(await stored(objectKey(user, lease, 'file'))).toEqual([[1, 2, 3, 4, 5], 'application/pdf']);
	expect(await stored(objectKey(user, unfinished, 'file'))).toBeNull();

	const kept = (await backups.list()).objects.map(object => object.key);
	expect(kept).toEqual(
		[
			`${FINAL_BACKUP}/database.json`,
			`${FINAL_BACKUP}/images/${user}/${photo}/full`,
			`${FINAL_BACKUP}/images/${user}/${photo}/thumb`,
			`${FINAL_BACKUP}/images/${user}/${lease}/part0`,
			`${FINAL_BACKUP}/images/${user}/${lease}/part1`,
			`${FINAL_BACKUP}/images/${user}/${unfinished}/part0`,
		].sort(),
	);
	expect(app.db.get(sql`SELECT name FROM sqlite_master WHERE name = 'images'`)).toBeFalsy();
	expect(await moveLegacyImages(app.db, attachments, backups, new Date())).toBeNull();
});
