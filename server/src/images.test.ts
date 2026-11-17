import { beforeAll, describe, expect, test } from 'bun:test';
import { orphans } from '../../shared/db/schema';
import { IMAGE_GRACE_MS, objectKey, sweepImages } from './images';
import { localBucket } from './local-bucket';
import { type Session, shareWith, signUp, taskRow, testApp, type TestApp, upload } from './test-app';

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

const path = (id: string, size: string, query: Record<string, string | undefined> = {}) =>
	`/api/images?${new URLSearchParams({ id, size, ...(JSON.parse(JSON.stringify(query)) as Record<string, string>) })}`;
const put = (
	session: Session,
	id: string,
	size: string,
	bytes: Uint8Array<ArrayBuffer>,
	type = 'image/jpeg',
	query: Record<string, string | undefined> = {},
) =>
	app.fetch(path(id, size, query), {
		method: 'PUT',
		headers: { ...session.headers, 'content-type': type },
		body: new Blob([bytes]),
	});
const get = (
	session: Session,
	id: string,
	size: string,
	query: Record<string, string | undefined> = {},
	headers = {},
) => app.fetch(path(id, size, query), { headers: { ...session.headers, ...headers } });
const post = (session: Session, id: string, query: Record<string, string>, body?: unknown) =>
	app.fetch(path(id, 'file', query), {
		method: 'POST',
		headers: session.headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

describe('/api/images', () => {
	test('the owner stores and reads an image; a retry keeps the first bytes; a wrong type is refused', async () => {
		const id = crypto.randomUUID();
		expect((await put(owner, id, 'full', JPEG)).status).toBe(200);
		expect((await put(owner, id, 'thumb', WEBP, 'image/webp')).status).toBe(200);
		expect((await put(owner, id, 'full', WEBP, 'image/webp')).status).toBe(200);
		const full = await get(owner, id, 'full');
		expect(full.headers.get('content-type')).toBe('image/jpeg');
		expect(full.headers.get('cache-control')).toContain('immutable');
		expect(await bytesOf(full)).toEqual(JPEG);
		const head = await app.fetch(path(id, 'thumb'), { method: 'HEAD', headers: owner.headers });
		expect([head.status, head.headers.get('content-length')]).toEqual([200, String(WEBP.byteLength)]);
		const again = await get(owner, id, 'full', {}, { 'if-none-match': full.headers.get('etag')! });
		expect(again.status).toBe(304);
		expect((await put(owner, crypto.randomUUID(), 'full', JPEG, 'image/webp')).status).toBe(415);
		expect((await put(owner, crypto.randomUUID(), 'thumb', new Uint8Array(200_001))).status).toBe(413);
		expect((await put(owner, id, 'part0', JPEG)).status).toBe(400);
		expect((await get(owner, 'missing-image-id', 'thumb')).status).toBe(404);
		expect((await app.fetch(path(id, 'full'))).status).toBe(401);
	});

	test('a file is one object, served as a type that cannot run script, with ranges', async () => {
		const html = new TextEncoder().encode('<script>alert(1)</script>');
		const page = crypto.randomUUID();
		expect((await put(owner, page, 'file', html, 'text/html', { name: 'page.html', type: 'text/html' })).status).toBe(
			200,
		);
		const served = await get(owner, page, 'file');
		expect(served.headers.get('content-type')).toBe('application/octet-stream');
		expect(served.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''page.html");
		expect(served.headers.get('x-content-type-options')).toBe('nosniff');
		expect(new TextDecoder().decode(await served.arrayBuffer())).toBe('<script>alert(1)</script>');

		const notes = crypto.randomUUID();
		const text = new TextEncoder().encode('0123456789');
		await put(owner, notes, 'file', text, 'text/plain', { name: "Stefan's notes (1).txt", type: 'text/plain' });
		const shown = await get(owner, notes, 'file');
		expect(shown.headers.get('content-type')).toBe('text/plain;charset=utf-8');
		expect(shown.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''Stefan%27s%20notes%20%281%29.txt");
		const downloaded = await get(owner, notes, 'file', { download: '1' });
		expect(downloaded.headers.get('content-disposition')).toMatch(/^attachment; filename/);
		const ranged = await get(owner, notes, 'file', {}, { range: 'bytes=2-5' });
		expect([ranged.status, ranged.headers.get('content-range')]).toEqual([206, 'bytes 2-5/10']);
		expect(new TextDecoder().decode(await ranged.arrayBuffer())).toBe('2345');
		const tail = await get(owner, notes, 'file', {}, { range: 'bytes=-3' });
		expect([tail.headers.get('content-range'), await tail.text()]).toEqual(['bytes 7-9/10', '789']);
		expect((await get(owner, notes, 'file', {}, { range: 'bytes=50-60' })).status).toBe(416);
		expect((await put(owner, crypto.randomUUID(), 'file', new Uint8Array(16 * 1024 * 1024 + 1))).status).toBe(413);
	});

	test('a long file goes up in parts, resumes, and reads back whole', async () => {
		const id = crypto.randomUUID();
		const first = Uint8Array.from({ length: 5 * 1024 * 1024 }, (_, index) => index & 0xff);
		const last = new Uint8Array([9, 8, 7]);
		const begun = await post(owner, id, { name: 'clip.mp4', type: 'video/mp4' });
		const { upload: uploadId } = (await begun.json()) as { upload: string };
		const part = async (number: number, bytes: Uint8Array<ArrayBuffer>, uploadTo = uploadId) =>
			put(owner, id, 'file', bytes, 'application/octet-stream', { upload: uploadTo, part: String(number) });
		expect((await part(1, first, 'unknown-upload')).status).toBe(404);
		expect((await part(0, first)).status).toBe(400);
		const etags = [await part(1, first), await part(2, last)].map(
			async response => ((await response.json()) as { etag: string }).etag,
		);
		expect((await get(owner, id, 'file')).status).toBe(404);
		expect((await post(owner, id, { upload: uploadId }, { parts: [] })).status).toBe(400);
		const parts = await Promise.all(etags);
		expect((await post(owner, id, { upload: uploadId }, { parts })).status).toBe(200);
		expect((await post(owner, id, { upload: uploadId }, { parts })).status).toBe(200);
		expect(await (await post(owner, id, { name: 'clip.mp4', type: 'video/mp4' })).json()).toEqual({ upload: null });

		const whole = await get(owner, id, 'file');
		expect(whole.headers.get('content-type')).toBe('video/mp4');
		expect(whole.headers.get('content-length')).toBe(String(first.byteLength + 3));
		const seam = await get(owner, id, 'file', {}, { range: `bytes=${first.byteLength - 2}-` });
		expect(await bytesOf(seam)).toEqual(new Uint8Array([254, 255, 9, 8, 7]));
	});

	test('a guest reads the images of the tasks it may see, uploads with an edit share, and nothing else', async () => {
		const guest = await signUp(app, 'Guest');
		const seen = crypto.randomUUID();
		const hidden = crypto.randomUUID();
		await put(owner, seen, 'full', JPEG);
		await put(owner, hidden, 'full', JPEG);
		const shared = crypto.randomUUID();
		const privateTask = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'tasks',
				id: shared,
				values: taskRow(shared, owner.person.id, 'Shared', {
					attachments: JSON.stringify([{ id: seen, width: 4, height: 3 }]),
				}),
			},
			{
				op: 'put',
				table: 'tasks',
				id: privateTask,
				values: taskRow(privateTask, owner.person.id, 'Private', {
					attachments: JSON.stringify([{ id: hidden, width: 4, height: 3 }]),
				}),
			},
		]);
		expect((await get(guest, seen, 'full', { space: owner.person.id })).status).toBe(403);
		const share = await shareWith(app, owner, { kind: 'task', id: shared }, guest.person.id, 'view');
		expect((await get(guest, seen, 'full', { space: owner.person.id })).status).toBe(200);
		expect((await get(guest, hidden, 'full', { space: owner.person.id })).status).toBe(404);
		expect((await put(guest, crypto.randomUUID(), 'full', JPEG, 'image/jpeg', { space: owner.person.id })).status).toBe(
			403,
		);
		await app.fetch(`/api/shares?id=${share.id}`, { method: 'DELETE', headers: owner.headers });
		await shareWith(app, owner, { kind: 'task', id: shared }, guest.person.id, 'edit');
		expect((await put(guest, crypto.randomUUID(), 'full', JPEG, 'image/jpeg', { space: owner.person.id })).status).toBe(
			200,
		);
	});

	test('the cron’s sweep marks unlisted attachments, clears the mark when listed again, and deletes them after the grace period', async () => {
		const bucket = localBucket(null);
		const other = await signUp(app, 'Sweeper');
		const [listed, orphan, taskId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
		await bucket.put(objectKey(owner.person.id, listed, 'full'), JPEG);
		await bucket.put(objectKey(owner.person.id, orphan, 'full'), JPEG);
		await bucket.put(objectKey(owner.person.id, orphan, 'thumb'), JPEG);
		await bucket.put(objectKey(other.person.id, orphan, 'file'), JPEG);
		const list = (ids: string[]) =>
			upload(app, owner, [
				{
					op: 'put',
					table: 'tasks',
					id: taskId,
					values: taskRow(taskId, owner.person.id, 'Pictured', {
						attachments: JSON.stringify(ids.map(id => ({ id, width: 4, height: 3 }))),
					}),
				},
			]);
		const name = (userId: string, id: string) =>
			`${userId === owner.person.id ? 'owner' : 'other'}:${id === listed ? 'listed' : 'orphan'}`;
		const marks = () =>
			Object.fromEntries(
				app.db
					.select()
					.from(orphans)
					.all()
					.map(row => [name(row.userId, row.id), row.orphanedAt]),
			);
		const kept = async () =>
			(await bucket.list()).objects.map(({ key }) => {
				const [userId, id, size] = key.split('/') as [string, string, string];
				return `${name(userId, id)}/${size}`;
			});
		const now = 1_800_000_000_000;
		await list([listed]);
		await sweepImages(app.db, bucket, now);
		expect(marks()).toEqual({ 'owner:orphan': now, 'other:orphan': now });
		await list([listed, orphan]);
		await sweepImages(app.db, bucket, now + 1000);
		expect(marks()).toEqual({ 'other:orphan': now });
		await list([listed]);
		await sweepImages(app.db, bucket, now + 2000);
		expect((await kept()).length).toBe(4);
		await sweepImages(app.db, bucket, now + 2000 + IMAGE_GRACE_MS);
		expect(marks()).toEqual({});
		expect(await kept()).toEqual(['owner:listed/full']);
	});
});
