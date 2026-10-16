import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Person, ShareView } from '../../../shared/sharing';
import { formatHlc } from '../../../shared/sync/hlc';
import type { Op, Task } from '../../../shared/sync/protocol';
import { fieldsOf } from '../../../shared/sync/snapshot';
import { project, section, snapshotOf, task } from '../../../shared/sync/testing';
import api from '../api';
import type { Env } from '../bindings';
import { migrateSync } from '../db/migrate';
import { localTurso } from '../db/test-turso';
import { memoryAccount } from './account';
import { databaseImages, guestImageAccess, IMAGE_GRACE_MS, memoryImages, sweepPlan, type ImageStore } from './images';
import { authHeaders, registerDevice, TEST_AUTH_SECRET, whoAmI, type DeviceCredentials } from './test-device';

const NOW = Date.UTC(2026, 9, 14, 18);
const HOUR = 60 * 60 * 1000;

const jpeg = (...rest: number[]) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...rest]);
const huge = () => {
	const bytes = new Uint8Array(1_500_001);
	bytes.set(jpeg());
	return bytes;
};
const webp = () =>
	new Uint8Array(
		[...'RIFF']
			.map(c => c.charCodeAt(0))
			.concat(
				[4, 0, 0, 0],
				[...'WEBP'].map(c => c.charCodeAt(0)),
			),
	);

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

const stores: [string, () => Promise<ImageStore>][] = [
	['memory', async () => memoryImages()],
	[
		'sqlite',
		async () => {
			const db = drizzle(new Database(':memory:', { strict: true }));
			migrateSync(db, 'strict');
			return databaseImages(() => db, 'user-1');
		},
	],
	['libsql', async () => databaseImages(await localTurso().then(db => () => db), 'user-1')],
];

describe.each(stores)('the %s image store', (_, open) => {
	test('reads back what it stored, by size, and a second put of an id keeps the first bytes', async () => {
		const store = await open();
		await store.put('photo-001', 'full', { type: 'image/jpeg', bytes: jpeg(1) }, NOW);
		await store.put('photo-001', 'thumb', { type: 'image/webp', bytes: webp() }, NOW);
		await store.put('photo-001', 'full', { type: 'image/jpeg', bytes: jpeg(2) }, NOW + 1);
		expect(await store.get('photo-001', 'full')).toEqual({ type: 'image/jpeg', bytes: jpeg(1) });
		expect(await store.get('photo-001', 'thumb')).toEqual({ type: 'image/webp', bytes: webp() });
		expect(await store.get('photo-002', 'full')).toBeNull();
	});

	test('a sweep marks unlisted images, keeps listed ones, and deletes them only after the grace period', async () => {
		const store = await open();
		for (const id of ['kept-0001', 'gone-0001', 'back-0001']) {
			await store.put(id, 'full', { type: 'image/jpeg', bytes: jpeg() }, NOW);
			await store.put(id, 'thumb', { type: 'image/jpeg', bytes: jpeg() }, NOW);
		}
		const sweep = async (listed: string[], at: number) =>
			store.sweep(sweepPlan(new Set(listed), await store.states(), at));
		await sweep(['kept-0001'], NOW);
		await sweep(['kept-0001', 'back-0001'], NOW + HOUR);
		await sweep(['kept-0001'], NOW + IMAGE_GRACE_MS - 1);
		expect(await store.get('gone-0001', 'full')).not.toBeNull();
		await sweep(['kept-0001'], NOW + IMAGE_GRACE_MS);
		expect(await store.get('gone-0001', 'full')).toBeNull();
		expect(await store.get('gone-0001', 'thumb')).toBeNull();
		expect(await store.get('kept-0001', 'thumb')).not.toBeNull();
		// Listed again at the second sweep and unlisted at the third, so its grace period counts from the third.
		expect(await store.get('back-0001', 'full')).not.toBeNull();
		await sweep(['kept-0001'], NOW + 2 * IMAGE_GRACE_MS - 2);
		expect(await store.get('back-0001', 'full')).not.toBeNull();
		await sweep(['kept-0001'], NOW + 2 * IMAGE_GRACE_MS - 1);
		expect(await store.get('back-0001', 'full')).toBeNull();
	});
});

describe('what a guest may do with images', () => {
	const ref = (id: string) => ({ id, width: 4, height: 3 });
	const snapshot = snapshotOf({
		projects: [project('home'), project('work')],
		sections: [section('kitchen', 'home')],
		tasks: [
			task('fridge', { projectId: 'home', sectionId: 'kitchen', images: [ref('fridge-01')] }),
			task('filter', { parentId: 'fridge', projectId: 'home', images: [ref('filter-01')] }),
			task('report', { projectId: 'work', images: [ref('report-01')] }),
		],
	});
	const share = (targetKind: 'project' | 'task', targetId: string, role: 'view' | 'edit') => ({
		id: `${targetKind}-${targetId}`,
		targetKind,
		targetId,
		grantee: 'guest',
		role,
		createdAt: 1,
	});

	test('a project share reads the images of its tasks, in sections and subtasks too, and nothing outside it', () => {
		const access = guestImageAccess(snapshot, [share('project', 'home', 'view')]);
		expect(['fridge-01', 'filter-01', 'report-01'].map(access.read)).toEqual([true, true, false]);
		expect(access.write).toBe(false);
	});

	test('any edit share may upload', () => {
		expect(guestImageAccess(snapshot, [share('task', 'report', 'edit')]).write).toBe(true);
	});
});

describe('the image routes', () => {
	type User = { cred: DeviceCredentials; env: Env; me: Person };
	let owner: User;
	let guest: User;
	let hlc = 0;

	beforeEach(async () => {
		const account = memoryAccount();
		const make = async (name: string): Promise<User> => {
			const env: Env = { ACCOUNT: account, BETTER_AUTH_SECRET: TEST_AUTH_SECRET };
			const cred = await registerDevice(env, name);
			return { cred, env, me: await whoAmI(env, cred) };
		};
		owner = await make('Owner Mac');
		guest = await make('Guest Phone');
	});

	const call = (user: User, method: string, path: string, init: { body?: BodyInit; type?: string } = {}) =>
		api.fetch(
			new Request(`https://procrastimate.test${path}`, {
				method,
				headers: { ...authHeaders(user.cred), ...(init.type ? { 'content-type': init.type } : {}) },
				body: init.body,
			}),
			owner.env,
		);
	const json = (user: User, method: string, path: string, body: unknown) =>
		call(user, method, path, { body: JSON.stringify(body), type: 'application/json' });

	const image = (id: string, size = 'full', space?: string) =>
		`/api/images?id=${id}&size=${size}${space ? `&space=${space}` : ''}`;
	const upload = (user: User, id: string, bytes: Uint8Array<ArrayBuffer>, space?: string, type = 'image/jpeg') =>
		call(user, 'PUT', image(id, 'full', space), { body: bytes, type });

	const create = (created: Task): Op => ({
		opId: `op-${++hlc}`,
		hlc: formatHlc({ wall: NOW + hlc, counter: 0, node: owner.cred.deviceId }),
		kind: 'task',
		id: created.id,
		fields: { deleted: false, ...fieldsOf('task', created) } as Op['fields'],
	});
	const edit = (id: string, fields: Op['fields']): Op => ({
		opId: `op-${++hlc}`,
		hlc: formatHlc({ wall: NOW + 10 * IMAGE_GRACE_MS + hlc, counter: 0, node: owner.cred.deviceId }),
		kind: 'task',
		id,
		fields,
	});
	const sync = (ops: Op[]) => json(owner, 'POST', '/api/sync', { cursor: 0, ops });
	const ref = (id: string) => ({ id, width: 4, height: 3 });

	test('the owner uploads, reads back with the type and a lasting cache, and an unknown id is not found', async () => {
		expect((await upload(owner, 'receipt-01', jpeg(7))).status).toBe(200);
		const read = await call(owner, 'GET', image('receipt-01'));
		expect(read.status).toBe(200);
		expect(read.headers.get('content-type')).toBe('image/jpeg');
		expect(read.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
		expect(new Uint8Array(await read.arrayBuffer())).toEqual(jpeg(7));
		expect((await call(owner, 'GET', image('receipt-01', 'thumb'))).status).toBe(404);
		expect((await call(owner, 'GET', image('missing-01'))).status).toBe(404);
	});

	test('an upload whose bytes are not its type, or past the size limit, is refused', async () => {
		expect((await upload(owner, 'fake-0001', webp(), undefined, 'image/jpeg')).status).toBe(415);
		expect((await upload(owner, 'fake-0001', jpeg(), undefined, 'image/png')).status).toBe(415);
		expect((await upload(owner, 'huge-0001', huge())).status).toBe(413);
		expect((await call(owner, 'GET', '/api/images?id=x&size=full')).status).toBe(400);
	});

	test('a guest reads the images of the tasks shared with it and uploads only with an edit share', async () => {
		expect(
			(
				await sync([
					create(task('fridge', { title: 'Fix the fridge', images: [ref('fridge-01')], createdAt: NOW })),
					create(task('diary', { title: 'Diary', images: [ref('diary-001')], createdAt: NOW + 1 })),
				])
			).status,
		).toBe(200);
		await upload(owner, 'fridge-01', jpeg(1));
		await upload(owner, 'diary-001', jpeg(2));
		const space = owner.me.id;
		expect((await call(guest, 'GET', image('fridge-01', 'full', space))).status).toBe(403);

		const share = async (role: 'view' | 'edit') => {
			const response = await json(owner, 'POST', '/api/shares', {
				target: { kind: 'task', id: 'fridge' },
				audience: { kind: 'user', userId: guest.me.id, role },
			});
			return (await response.json()) as ShareView;
		};
		const viewing = await share('view');
		const read = await call(guest, 'GET', image('fridge-01', 'full', space));
		expect(new Uint8Array(await read.arrayBuffer())).toEqual(jpeg(1));
		expect((await call(guest, 'GET', image('diary-001', 'full', space))).status).toBe(404);
		expect((await upload(guest, 'guest-0001', jpeg(3), space)).status).toBe(403);

		await json(owner, 'DELETE', `/api/shares?id=${viewing.id}`, undefined);
		await share('edit');
		expect((await upload(guest, 'guest-0001', jpeg(3), space)).status).toBe(200);
		expect(new Uint8Array(await (await call(owner, 'GET', image('guest-0001'))).arrayBuffer())).toEqual(jpeg(3));
		// An id it can see on a task it may only read keeps the owner's bytes.
		expect((await upload(guest, 'diary-001', jpeg(9), space)).status).toBe(200);
		expect(new Uint8Array(await (await call(owner, 'GET', image('diary-001'))).arrayBuffer())).toEqual(jpeg(2));
	});

	test('the images of a deleted task are gone once the grace period has passed', async () => {
		await upload(owner, 'invoice-1', jpeg(1));
		await sync([create(task('bill', { title: 'Pay the bill', images: [ref('invoice-1')], createdAt: NOW }))]);
		setSystemTime(NOW + HOUR);
		await sync([edit('bill', { deleted: true })]);
		setSystemTime(NOW + HOUR + IMAGE_GRACE_MS - 1);
		await sync([create(task('later', { title: 'Something later', createdAt: NOW + 2 }))]);
		await new Promise(resolve => setTimeout(resolve, 20));
		expect((await call(owner, 'GET', image('invoice-1'))).status).toBe(200);
		setSystemTime(NOW + 2 * HOUR + IMAGE_GRACE_MS);
		await sync([create(task('even-later', { title: 'Even later', createdAt: NOW + 3 }))]);
		await new Promise(resolve => setTimeout(resolve, 20));
		expect((await call(owner, 'GET', image('invoice-1'))).status).toBe(404);
	});
});
