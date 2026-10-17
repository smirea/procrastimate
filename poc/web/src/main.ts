import { wrapPowerSyncWithDrizzle } from '@powersync/drizzle-driver';
import {
	PowerSyncDatabase,
	UpdateType,
	type AbstractPowerSyncDatabase,
	type PowerSyncBackendConnector,
} from '@powersync/web';
import { eq } from 'drizzle-orm';
import { AppSchema, drizzleSchema, tasks } from './schema';

const out = document.getElementById('out')!;
const log = (line: string) => (out.textContent += `\n${line}`);

const json = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body),
});
const rejections: string[] = [];
const uploads: { ms: number; serverMs: number }[] = [];

const connector: PowerSyncBackendConnector = {
	async fetchCredentials() {
		const response = await fetch('/api/auth/token');
		if (!response.ok) return null;
		const { token } = await response.json();
		return { endpoint: `${location.origin}/api/powersync`, token };
	},
	async uploadData(database: AbstractPowerSyncDatabase) {
		const batch = await database.getCrudBatch(200);
		if (!batch) return;
		const ops = batch.crud.map(entry => ({
			op: entry.op === UpdateType.PUT ? 'PUT' : entry.op === UpdateType.PATCH ? 'PATCH' : 'DELETE',
			type: entry.table,
			id: entry.id,
			data: entry.opData,
		}));
		const started = performance.now();
		const response = await fetch('/api/upload', json({ batch: ops }));
		if (!response.ok) throw new Error(`upload ${response.status}`);
		const { rejected, ms } = await response.json();
		uploads.push({ ms: Math.round(performance.now() - started), serverMs: ms });
		rejections.push(...rejected);
		await batch.complete();
	},
};

const powerSync = new PowerSyncDatabase({
	schema: AppSchema,
	database: { dbFilename: `poc-${new URLSearchParams(location.search).get('db') ?? 'a'}.db` },
});
const db = wrapPowerSyncWithDrizzle(powerSync, { schema: drizzleSchema });

const seen = new Map<string, number>();
powerSync.onChange(
	{
		onChange: async () => {
			const rows = await db.select({ id: tasks.id, title: tasks.title }).from(tasks);
			for (const row of rows)
				if (!seen.has(`${row.id}:${row.title}`))
					seen.set(`${row.id}:${row.title}`, performance.now() + performance.timeOrigin);
		},
	},
	{ tables: ['tasks'], throttleMs: 0 },
);

let userId = '';
const api = {
	async signUp(email: string) {
		const r = await fetch('/api/auth/sign-up/email', json({ email, password: 'password123', name: email }));
		userId = (await r.json()).user.id;
		return userId;
	},
	async signIn(email: string) {
		const r = await fetch('/api/auth/sign-in/email', json({ email, password: 'password123' }));
		userId = (await r.json()).user.id;
		return userId;
	},
	async connect() {
		await powerSync.connect(connector, { crudUploadThrottleMs: 0 });
		await powerSync.waitForFirstSync();
		return powerSync.currentStatus.toJSON();
	},
	async add(title: string, owner = userId) {
		const id = crypto.randomUUID();
		await db
			.insert(tasks)
			.values({
				id,
				userId: owner,
				title,
				notes: '',
				labelIds: ['l1', 'l2'],
				due: { date: '2026-10-20' },
				priority: 4,
				order: 0.5,
				createdAt: Date.now(),
			});
		return { id, at: performance.now() + performance.timeOrigin };
	},
	async rename(id: string, title: string) {
		await db.update(tasks).set({ title }).where(eq(tasks.id, id));
		return performance.now() + performance.timeOrigin;
	},
	async remove(id: string) {
		await db.delete(tasks).where(eq(tasks.id, id));
	},
	list: () => db.select().from(tasks),
	access: () => db.select().from(drizzleSchema.access),
	seenAt: (id: string, title: string) => seen.get(`${id}:${title}`) ?? null,
	share: (taskId: string, grantee: string, role: 'view' | 'edit' | null) =>
		fetch('/api/share', json({ taskId, grantee, role })).then(r => r.json()),
	pending: async () => (await powerSync.getCrudBatch(1000))?.crud.length ?? 0,
	rejections: () => rejections,
	uploads: () => uploads,
	user: () => userId,
};
Object.assign(window, { poc: api });
log('ready');
