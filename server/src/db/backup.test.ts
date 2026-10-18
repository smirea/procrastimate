import { afterAll, beforeAll, expect, test } from 'bun:test';
import { images } from '../../../shared/db/schema';
import { signUp, testApp, type TestApp } from '../test-app';
import { backupKey, dumpJson } from './backup';

let app: TestApp;
beforeAll(async () => {
	app = await testApp();
});
afterAll(() => app.close());

test('the dump carries a full-size image as base64 and names the day', async () => {
	const owner = await signUp(app, 'Owner');
	const bytes = Uint8Array.from({ length: 1_500_000 }, (_, i) => (i * 7) & 0xff);
	await app.db.insert(images).values({
		userId: owner.person.id,
		id: 'photo',
		size: 'full',
		type: 'image/jpeg',
		bytes,
		createdAt: 1,
		orphanedAt: null,
	});
	const at = new Date('2026-10-18T09:00:00Z');
	const dump = JSON.parse(await dumpJson(app.db, at)) as {
		at: string;
		tables: Record<string, Record<string, unknown>[]>;
	};
	expect(dump.at).toBe('2026-10-18T09:00:00.000Z');
	const [row] = dump.tables.images as { id: string; bytes: { $bytes: string } }[];
	expect(row!.id).toBe('photo');
	expect(Uint8Array.from(atob(row!.bytes.$bytes), char => char.charCodeAt(0))).toEqual(bytes);
	expect(dump.tables.user!.map(user => user.id)).toEqual([owner.person.id]);
	expect(backupKey(at)).toBe('postgres/2026-10-18.json');
});
