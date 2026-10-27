import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { log, push, tasks } from '../../shared/db/schema';
import type { PushMessage } from '../../shared/push';
import { deliverDue, isAllowedEndpoint, touchesPush } from './push';
import { json, signUp, taskRow, testApp, upload, type Session, type TestApp } from './test-app';

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
		expect(row?.notifications.map(n => n.opens.id)).toEqual([id]);
		expect(row?.nextAt).toBe(Date.UTC(2026, 9, 14, 18, 30));
		const schedule = await json<{ notifications: { opens: { id: string } }[] }>(
			app.fetch('/api/push/schedule', { headers: owner.headers }),
		);
		expect(schedule.notifications.map(n => n.opens.id)).toEqual([id]);

		await upload(app, owner, [{ op: 'patch', table: 'tasks', id, values: { completed_at: NOW } }]);
		expect((await rows())[0]?.notifications).toEqual([]);
		expect((await rows())[0]?.nextAt).toBeNull();
	});

	test('a browser that subscribes after the reminders exist gets them planned at once', async () => {
		const late = await signUp(app, 'Late', 'install-late-0000');
		const id = crypto.randomUUID();
		const due = { date: '2026-10-14', time: '19:15' };
		await upload(app, late, [
			{
				op: 'put',
				table: 'tasks',
				id,
				values: taskRow(id, late.person.id, 'Water plants', { due: JSON.stringify(due) }),
			},
		]);
		const subscribed = await app.fetch('/api/push/subscription', {
			method: 'PUT',
			headers: late.headers,
			body: JSON.stringify({ subscription: subscription('https://push.example/late') }),
		});
		expect(subscribed.status).toBe(200);
		const [row] = await app.db.select().from(push).where(eq(push.userId, late.person.id));
		expect(row?.notifications.map(n => n.opens.id)).toEqual([id]);
		expect(row?.nextAt).toBe(Date.UTC(2026, 9, 14, 19, 15));
	});

	test('a delete retried after its row went, but before its log and replan ran, finishes both once', async () => {
		const retrier = await signUp(app, 'Retrier', 'install-retry-000');
		await app.fetch('/api/push/subscription', {
			method: 'PUT',
			headers: retrier.headers,
			body: JSON.stringify({ subscription: subscription('https://push.example/retry') }),
		});
		const id = crypto.randomUUID();
		const kept = crypto.randomUUID();
		const due = JSON.stringify({ date: '2026-10-14', time: '20:00' });
		// A second task keeps the space from emptying, which would purge the delete's log row.
		await upload(app, retrier, [
			{ op: 'put', table: 'tasks', id, values: taskRow(id, retrier.person.id, 'Feed the cat', { due }) },
			{ op: 'put', table: 'tasks', id: kept, values: taskRow(kept, retrier.person.id, 'Water the plants') },
		]);
		const plan = async () =>
			(await app.db.select().from(push).where(eq(push.userId, retrier.person.id)))[0]?.notifications.map(
				n => n.opens.id,
			);
		expect(await plan()).toEqual([id]);
		// The state a crash between the delete and its bookkeeping leaves: the row gone, nothing else changed.
		await app.db.delete(tasks).where(eq(tasks.id, id));
		const deletes = () =>
			app.db
				.select({ op: log.op })
				.from(log)
				.where(and(eq(log.userId, retrier.person.id), eq(log.id, id), eq(log.op, 'delete')));
		const retry = [{ op: 'delete', table: 'tasks', id, opId: `${id}:delete` }];
		expect(await upload(app, retrier, retry)).toEqual([]);
		expect(await plan()).toEqual([]);
		expect(await deletes()).toEqual([{ op: 'delete' }]);
		expect(await upload(app, retrier, retry)).toEqual([]);
		expect(await deletes()).toEqual([{ op: 'delete' }]);
	});

	test('the cron sends what is due, settles it, retries a failure, and drops a gone subscription', async () => {
		const subscribed = await app.fetch('/api/push/subscription', {
			method: 'PUT',
			headers: owner.headers,
			body: JSON.stringify({ subscription: subscription('https://push.example/a') }),
		});
		expect(subscribed.status).toBe(200);
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
		expect((await rows())[0]?.notifications.map(n => n.opens.id)).toEqual([id]);

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

	test('a 410 for a subscription made within two minutes retries, and one for an older subscription drops it', async () => {
		const fresh = await signUp(app, 'Fresh', 'install-fresh-000');
		const rowsOf = () => app.db.select().from(push).where(eq(push.userId, fresh.person.id));
		await app.fetch('/api/push/subscription', {
			method: 'PUT',
			headers: fresh.headers,
			body: JSON.stringify({ subscription: subscription('https://push.example/fresh') }),
		});
		const soon = crypto.randomUUID();
		const later = crypto.randomUUID();
		await upload(app, fresh, [
			{
				op: 'put',
				table: 'tasks',
				id: soon,
				values: taskRow(soon, fresh.person.id, 'Soon', { due: JSON.stringify({ date: '2026-10-14', time: '18:01' }) }),
			},
			{
				op: 'put',
				table: 'tasks',
				id: later,
				values: taskRow(later, fresh.person.id, 'Later', {
					due: JSON.stringify({ date: '2026-10-14', time: '18:30' }),
				}),
			},
		]);
		let status = 410;
		const sent: string[] = [];
		const send = async (_subscription: unknown, message: PushMessage) => {
			sent.push(message.title);
			return status;
		};

		expect(await deliverDue(app.db, Date.UTC(2026, 9, 14, 18, 1), send)).toBe(0);
		expect((await rowsOf())[0]?.notifications.map(n => n.opens.id)).toEqual([soon, later]);
		expect((await rowsOf())[0]?.nextAt).toBe(Date.UTC(2026, 9, 14, 18, 2));

		status = 201;
		expect(await deliverDue(app.db, Date.UTC(2026, 9, 14, 18, 2), send)).toBe(1);
		expect(sent).toEqual(['Soon', 'Soon']);

		status = 410;
		expect(await deliverDue(app.db, Date.UTC(2026, 9, 14, 18, 30), send)).toBe(0);
		expect(sent).toEqual(['Soon', 'Soon', 'Later']);
		expect(await rowsOf()).toEqual([]);
	});

	test('tasks due at the same minute send one push that names them and opens their list', async () => {
		const grouper = await signUp(app, 'Grouper', 'install-group-000');
		await app.fetch('/api/push/subscription', {
			method: 'PUT',
			headers: grouper.headers,
			body: JSON.stringify({ subscription: subscription('https://push.example/group') }),
		});
		const due = JSON.stringify({ date: '2026-10-14', time: '21:00' });
		const ids = [crypto.randomUUID(), crypto.randomUUID()];
		await upload(
			app,
			grouper,
			['Pack', 'Charge phone'].map((title, i) => ({
				op: 'put',
				table: 'tasks',
				id: ids[i] ?? '',
				values: taskRow(ids[i] ?? '', grouper.person.id, title, { due }),
			})),
		);
		const sent: PushMessage[] = [];
		await deliverDue(app.db, Date.UTC(2026, 9, 14, 21, 0, 5), async (_subscription, message) => {
			sent.push(message);
			return 201;
		});
		expect(sent).toEqual([
			{
				title: '2 tasks',
				body: 'Pack, Charge phone',
				tag: `at:${Date.UTC(2026, 9, 14, 21, 0)}`,
				opens: { kind: 'inbox', id: '' },
			},
		]);
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

describe('touchesPush', () => {
	test('moving a task to another project replans, since a group opens the project its tasks share', () => {
		expect(touchesPush({ op: 'patch', kind: 'task', id: 't', values: { projectId: 'work' } })).toBe(true);
		expect(touchesPush({ op: 'patch', kind: 'task', id: 't', values: { title: 'Pack' } })).toBe(false);
	});
});

describe('isAllowedEndpoint', () => {
	test('only https on a browser push host', () => {
		expect(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
		expect(isAllowedEndpoint('https://web.push.apple.com/QW')).toBe(true);
		expect(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
		expect(isAllowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
		expect(isAllowedEndpoint('https://push.example/a')).toBe(true);
		expect(isAllowedEndpoint('https://internal.example.net/admin')).toBe(false);
		expect(isAllowedEndpoint('https://evilpush.apple.com.attacker.io/x')).toBe(false);
		expect(isAllowedEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
		expect(isAllowedEndpoint('http://127.0.0.1:9/send')).toBe(false);
	});
});
