import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { push } from '../../shared/db/schema';
import type { PushMessage } from '../../shared/push';
import { deliverDue } from './push';
import { json, signUp, taskRow, testApp, upload, type Session, type TestApp } from './test-app';

/**
 * Push through the routes and the cron: a subscription, tasks that notify, `replan` after every upload, and
 * `deliverDue` sending, retrying, and dropping gone subscriptions.
 */

const NOW = Date.UTC(2026, 9, 14, 18, 0);
beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner', 'install-a-0000000');
});
afterAll(() => app.close());

const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });

const rows = () => app.db.select().from(push).where(eq(push.userId, owner.person.id));

describe('push', () => {
	test('subscribing stores the install, and each upload replans its notifications with next_at', async () => {
		const subscribed = await app.fetch('/api/push/subscription', {
			method: 'PUT',
			headers: owner.headers,
			body: JSON.stringify({ subscription: subscription('https://push.example/a') }),
		});
		expect(subscribed.status).toBe(200);
		expect(await rows()).toHaveLength(1);

		const id = crypto.randomUUID();
		const due = { date: '2026-10-14', time: '18:30' };
		await upload(app, owner, [
			{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Call mum', { due: JSON.stringify(due) }) },
		]);
		const [row] = await rows();
		expect(row?.notifications.map(n => n.taskId)).toEqual([id]);
		expect(row?.nextAt).toBe(Date.UTC(2026, 9, 14, 18, 30));
		const schedule = await json<{ notifications: { taskId: string }[] }>(
			app.fetch('/api/push/schedule', { headers: owner.headers }),
		);
		expect(schedule.notifications.map(n => n.taskId)).toEqual([id]);

		await upload(app, owner, [{ op: 'patch', table: 'tasks', id, values: { completed_at: NOW } }]);
		expect((await rows())[0]?.notifications).toEqual([]);
		expect((await rows())[0]?.nextAt).toBeNull();
	});

	test('the cron sends what is due, settles it, retries a failure, and drops a gone subscription', async () => {
		const id = crypto.randomUUID();
		const due = { date: '2026-10-14', time: '18:45' };
		await upload(app, owner, [
			{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Stretch', { due: JSON.stringify(due) }) },
		]);
		const sent: PushMessage[] = [];
		let status: number | null = 500;
		const send = async (_subscription: unknown, message: PushMessage) => {
			sent.push(message);
			return status;
		};
		expect(await deliverDue(app.db, Date.UTC(2026, 9, 14, 18, 40), send)).toBe(0);
		expect(sent).toHaveLength(0);

		const at = Date.UTC(2026, 9, 14, 18, 45, 10);
		expect(await deliverDue(app.db, at, send)).toBe(0);
		expect(sent.map(message => message.title)).toEqual(['Stretch']);
		expect((await rows())[0]?.notifications.map(n => n.taskId)).toEqual([id]);

		status = 201;
		expect(await deliverDue(app.db, at + 60_000, send)).toBe(1);
		expect((await rows())[0]?.notifications).toEqual([]);

		const later = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'tasks',
				id: later,
				values: taskRow(later, owner.person.id, 'Later', {
					due: JSON.stringify({ date: '2026-10-14', time: '19:00' }),
				}),
			},
		]);
		status = 410;
		await deliverDue(app.db, Date.UTC(2026, 9, 14, 19, 0, 5), send);
		expect(await rows()).toHaveLength(0);
	});

	test('a browser that paired again as a new install replaces its old entry for the same endpoint', async () => {
		const again = await signUp(app, 'Again', 'install-b-0000000');
		const subscribe = (session: Session) =>
			app.fetch('/api/push/subscription', {
				method: 'PUT',
				headers: session.headers,
				body: JSON.stringify({ subscription: subscription('https://push.example/same') }),
			});
		await subscribe(again);
		const second = { ...again, headers: { ...again.headers, 'x-procrastimate-device': 'install-c-0000000' } };
		await subscribe(second);
		const stored = await app.db.select().from(push).where(eq(push.userId, again.person.id));
		expect(stored.map(row => row.deviceId)).toEqual(['install-c-0000000']);
		expect((await app.fetch('/api/push/subscription', { method: 'DELETE', headers: second.headers })).status).toBe(200);
		expect(await app.db.select().from(push).where(eq(push.userId, again.person.id))).toEqual([]);
	});
});
