import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { images } from '../../shared/db/schema';
import { IMAGE_GRACE_MS, sweepImages } from './images';
import { type Session, shareWith, signUp, taskRow, testApp, type TestApp, upload } from './test-app';

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
});
afterAll(() => app.close());

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

const put = (
	session: Session,
	id: string,
	size: string,
	bytes: Uint8Array<ArrayBuffer>,
	type = 'image/jpeg',
	space?: string,
) =>
	app.fetch(`/api/images?id=${id}&size=${size}${space ? `&space=${space}` : ''}`, {
		method: 'PUT',
		headers: { ...session.headers, 'content-type': type },
		body: new Blob([bytes]),
	});
const get = (session: Session, id: string, size: string, space?: string) =>
	app.fetch(`/api/images?id=${id}&size=${size}${space ? `&space=${space}` : ''}`, { headers: session.headers });

describe('/api/images', () => {
	test('the owner stores and reads an image; a retry keeps the first bytes; a wrong type is refused', async () => {
		const id = crypto.randomUUID();
		expect((await put(owner, id, 'full', JPEG)).status).toBe(200);
		expect((await put(owner, id, 'thumb', WEBP, 'image/webp')).status).toBe(200);
		expect((await put(owner, id, 'full', WEBP, 'image/webp')).status).toBe(200);
		const full = await get(owner, id, 'full');
		expect(full.headers.get('content-type')).toBe('image/jpeg');
		expect(new Uint8Array(await full.arrayBuffer())).toEqual(JPEG);
		expect(full.headers.get('cache-control')).toContain('immutable');
		expect((await put(owner, crypto.randomUUID(), 'full', JPEG, 'image/webp')).status).toBe(415);
		expect((await get(owner, 'missing-image-id', 'thumb')).status).toBe(404);
		expect((await app.fetch(`/api/images?id=${id}&size=full`)).status).toBe(401);
	});

	test('a file is stored as opaque parts of any type, each under the part cap, and answered as a download', async () => {
		const id = crypto.randomUUID();
		const html = new TextEncoder().encode('<script>alert(1)</script>');
		expect((await put(owner, id, 'part0', html, 'text/html')).status).toBe(200);
		expect((await put(owner, id, 'part1', JPEG, 'application/pdf')).status).toBe(200);
		const first = await get(owner, id, 'part0');
		expect(first.headers.get('content-type')).toBe('application/octet-stream');
		expect(first.headers.get('content-disposition')).toBe('attachment');
		expect(first.headers.get('x-content-type-options')).toBe('nosniff');
		expect(new TextDecoder().decode(await first.arrayBuffer())).toBe('<script>alert(1)</script>');
		expect(new Uint8Array(await (await get(owner, id, 'part1')).arrayBuffer())).toEqual(JPEG);
		expect((await put(owner, id, 'part2', new Uint8Array(1_500_001), 'application/pdf')).status).toBe(413);
		expect((await put(owner, id, 'part17', JPEG)).status).toBe(400);
		expect((await put(owner, id, 'parts', JPEG)).status).toBe(400);
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
		expect((await get(guest, seen, 'full', owner.person.id)).status).toBe(403);
		const share = await shareWith(app, owner, { kind: 'task', id: shared }, guest.person.id, 'view');
		expect((await get(guest, seen, 'full', owner.person.id)).status).toBe(200);
		expect((await get(guest, hidden, 'full', owner.person.id)).status).toBe(404);
		expect((await put(guest, crypto.randomUUID(), 'full', JPEG, 'image/jpeg', owner.person.id)).status).toBe(403);
		await app.fetch(`/api/shares?id=${share.id}`, { method: 'DELETE', headers: owner.headers });
		await shareWith(app, owner, { kind: 'task', id: shared }, guest.person.id, 'edit');
		expect((await put(guest, crypto.randomUUID(), 'full', JPEG, 'image/jpeg', owner.person.id)).status).toBe(200);
	});

	test('the cron’s sweep marks unlisted images, clears the mark when listed again, and drops them after the grace period', async () => {
		const other = await signUp(app, 'Sweeper');
		const [listed, orphan, taskId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
		await put(owner, listed, 'full', JPEG);
		await put(owner, orphan, 'full', JPEG);
		await put(other, orphan, 'thumb', JPEG);
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
		const states = async () =>
			Object.fromEntries(
				(
					await app.db
						.select({ userId: images.userId, id: images.id, orphanedAt: images.orphanedAt })
						.from(images)
						.where(inArray(images.id, [listed, orphan]))
				).map(row => [
					`${row.userId === owner.person.id ? 'owner' : 'other'}:${row.id === listed ? 'listed' : 'orphan'}`,
					row.orphanedAt,
				]),
			);
		const now = 1_800_000_000_000;
		await list([listed]);
		await sweepImages(app.db, now);
		expect(await states()).toEqual({ 'owner:listed': null, 'owner:orphan': now, 'other:orphan': now });
		await list([listed, orphan]);
		await sweepImages(app.db, now + 1000);
		expect(await states()).toEqual({ 'owner:listed': null, 'owner:orphan': null, 'other:orphan': now });
		await list([listed]);
		await sweepImages(app.db, now + 2000);
		await sweepImages(app.db, now + 2000 + IMAGE_GRACE_MS);
		expect(await states()).toEqual({ 'owner:listed': null });
	});
});
