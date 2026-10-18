import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { images } from '../../shared/db/schema';
import { IMAGE_GRACE_MS, sweepImages } from './images';
import { aiAccount, type Session, shareWith, signUp, taskRow, testApp, type TestApp, upload } from './test-app';

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
					images: JSON.stringify([{ id: seen, width: 4, height: 3 }]),
				}),
			},
			{
				op: 'put',
				table: 'tasks',
				id: privateTask,
				values: taskRow(privateTask, owner.person.id, 'Private', {
					images: JSON.stringify([{ id: hidden, width: 4, height: 3 }]),
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

	test('an AI token reads the images of its owner’s space and may not upload', async () => {
		const id = crypto.randomUUID();
		await put(owner, id, 'full', JPEG);
		const taskId = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'tasks',
				id: taskId,
				values: taskRow(taskId, owner.person.id, 'Pictured', { images: JSON.stringify([{ id, width: 4, height: 3 }]) }),
			},
		]);
		const { headers } = await aiAccount(app, owner);
		expect((await app.fetch(`/api/images?id=${id}&size=full`, { headers })).status).toBe(200);
		const refused = await app.fetch(`/api/images?id=${crypto.randomUUID()}&size=full`, {
			method: 'PUT',
			headers: { ...headers, 'content-type': 'image/jpeg' },
			body: new Blob([JPEG]),
		});
		expect(refused.status).toBe(403);
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
						images: JSON.stringify(ids.map(id => ({ id, width: 4, height: 3 }))),
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
