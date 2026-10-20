import { afterAll, afterEach, beforeAll, describe, expect, jest, setSystemTime, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { rambleUsage } from '../../shared/db/schema';
import { RAMBLE_BYTES_PER_SECOND, RAMBLE_DAILY_SECONDS, RAMBLE_SESSION_SECONDS } from '../../shared/ramble/protocol';
import { rambleRoute, type ConnectUpstream, type RambleRoute } from './ramble';
import type { Socket, StreamEvents } from './sockets';
import { shareWith, signUp, testApp, upload, type Session, type TestApp } from './test-app';

/** An upstream that starts at once and commits with no text, so a session ends as soon as it is asked to. */
let keyterms: string[] = [];
const upstream: ConnectUpstream = async (session, events) => {
	keyterms = session.keyterms;
	setTimeout(() => events.message(JSON.stringify({ message_type: 'session_started' })), 0);
	return {
		send(text) {
			if ((JSON.parse(text) as { commit: boolean }).commit) {
				setTimeout(() => events.message(JSON.stringify({ message_type: 'committed_transcript', text: '' })), 0);
			}
		},
		close() {},
	};
};

type Sent = { type: string; reason?: string; seconds?: number; code?: string };
type Opened = { sent: Sent[]; events: StreamEvents; received(type: string | null): Promise<Sent> };

let app: TestApp;
let me: Session;
let route: RambleRoute;
let pending: ((socket: Socket) => StreamEvents) | null = null;
beforeAll(async () => {
	app = await testApp();
	me = await signUp(app, 'Rambler');
	route = rambleRoute(
		app.db,
		(_request, _protocol, start) => {
			pending = start;
			return new Response(null);
		},
		upstream,
	);
});
afterAll(() => app.close());

/** Resolves once the session has sent its first message: `started`, or the refusal of a used-up day. */
async function open(person = me.person): Promise<Opened> {
	pending = null;
	const request = new Request('https://procrastimate.test/api/ramble/socket', { headers: { Upgrade: 'websocket' } });
	await route(request, person);
	if (!pending) throw new Error('the route did not open a session');
	const sent: Sent[] = [];
	const waiting: { type: string | null; resolve(message: Sent): void }[] = [];
	const events = (pending as (socket: Socket) => StreamEvents)({
		send(text) {
			const message: Sent = JSON.parse(text);
			sent.push(message);
			for (const waiter of waiting.splice(0)) {
				if (waiter.type === null || waiter.type === message.type) waiter.resolve(message);
				else waiting.push(waiter);
			}
		},
		close() {},
	});
	const received = async (type: string | null) =>
		sent.find(message => type === null || message.type === type) ??
		new Promise<Sent>(resolve => waiting.push({ type, resolve }));
	await received(null);
	return { sent, events, received };
}

const second = new Uint8Array(RAMBLE_BYTES_PER_SECOND);
function stream(session: Opened, seconds: number) {
	for (let i = 0; i < seconds; i++) session.events.message(second);
}

describe('the Ramble caps', () => {
	afterEach(() => setSystemTime());

	test('a frame past the session cap is cut at it and the session ends', async () => {
		const session = await open();
		stream(session, RAMBLE_SESSION_SECONDS + 1);
		expect(await session.received('ended')).toEqual({
			type: 'ended',
			seconds: RAMBLE_SESSION_SECONDS,
			reason: 'session-limit',
		});
	});

	test('the daily cap holds for a session opened before the sessions that used the day up', async () => {
		// Its own person and a pinned noon, so the day starts empty whatever ran before and no midnight passes mid-test.
		setSystemTime(new Date(Date.UTC(2026, 9, 20, 16)));
		const capped = (await signUp(app, 'Capped')).person;
		const stale = await open(capped);
		let streamed = 0;
		while (streamed < RAMBLE_DAILY_SECONDS) {
			const session = await open(capped);
			stream(session, RAMBLE_SESSION_SECONDS);
			streamed += (await session.received('ended')).seconds!;
			session.events.close();
		}
		expect(streamed).toBe(RAMBLE_DAILY_SECONDS);
		stream(stale, 1);
		stale.events.message(JSON.stringify({ type: 'stop' }));
		expect(await stale.received('ended')).toEqual({ type: 'ended', seconds: 0, reason: 'daily-limit' });
		const refused = await open(capped);
		expect(refused.sent.map(message => message.code)).toEqual(['daily-limit']);
	});
});

describe('a Ramble session', () => {
	afterEach(() => {
		jest.useRealTimers();
		setSystemTime();
	});

	test('a socket that sends nothing for a minute ends with idle, after a final commit', async () => {
		const quiet = await signUp(app, 'Quiet');
		const session = await open(quiet.person);
		jest.useFakeTimers();
		session.events.message(second);
		jest.advanceTimersByTime(60_000);
		jest.advanceTimersByTime(1);
		expect(await session.received('ended')).toEqual({ type: 'ended', seconds: 1, reason: 'idle' });
	});

	test('a session open across midnight stores the seconds before it on that day and the rest on the next', async () => {
		const night = await signUp(app, 'Nightowl');
		expect(
			await upload(app, night, [
				{ op: 'patch', table: 'settings', id: 'settings', values: { time_zone: 'America/New_York' } },
			]),
		).toEqual([]);
		setSystemTime(new Date(Date.UTC(2026, 9, 20, 3, 59, 59)));
		const session = await open(night.person);
		stream(session, 1);
		setSystemTime(new Date(Date.UTC(2026, 9, 20, 4, 0, 1)));
		stream(session, 1);
		session.events.message(JSON.stringify({ type: 'stop' }));
		expect(await session.received('ended')).toEqual({ type: 'ended', seconds: 2, reason: 'stopped' });
		const days = await app.db
			.select({ day: rambleUsage.day, seconds: rambleUsage.seconds })
			.from(rambleUsage)
			.where(eq(rambleUsage.userId, night.person.id))
			.orderBy(rambleUsage.day);
		expect(days).toEqual([
			{ day: '2026-10-19', seconds: 1 },
			{ day: '2026-10-20', seconds: 1 },
		]);
	});
});

describe('the Ramble keyterms', () => {
	test('take the names of projects and labels shared to edit, never those shared to view', async () => {
		const owner = await signUp(app, 'Sharer');
		const guest = await signUp(app, 'Guest');
		const row = (name: string) => ({ id: crypto.randomUUID(), user_id: owner.person.id, name, created_at: 1 });
		const [garden, attic, chores, secret] = [row('Garden'), row('Attic'), row('Chores'), row('Secret')];
		const mine = { id: crypto.randomUUID(), user_id: guest.person.id, name: 'Errands', created_at: 1 };
		expect(
			await upload(app, owner, [
				...[garden, attic].map(values => ({ op: 'put', table: 'projects', id: values.id, values })),
				...[chores, secret].map(values => ({ op: 'put', table: 'labels', id: values.id, values })),
			]),
		).toEqual([]);
		expect(await upload(app, guest, [{ op: 'put', table: 'projects', id: mine.id, values: mine }])).toEqual([]);
		await shareWith(app, owner, { kind: 'project', id: garden.id }, guest.person.id, 'edit');
		await shareWith(app, owner, { kind: 'project', id: attic.id }, guest.person.id, 'view');
		await shareWith(app, owner, { kind: 'label', id: chores.id }, guest.person.id, 'edit');
		await shareWith(app, owner, { kind: 'label', id: secret.id }, guest.person.id, 'view');

		await open(guest.person);
		expect(keyterms).toEqual(['subtask', 'priority', 'remind', 'project', 'label', 'Chores', 'Errands', 'Garden']);
	});
});
