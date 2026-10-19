import { afterAll, afterEach, beforeAll, describe, expect, jest, setSystemTime, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { rambleUsage } from '../../shared/db/schema';
import { RAMBLE_BYTES_PER_SECOND, RAMBLE_DAILY_SECONDS, RAMBLE_SESSION_SECONDS } from '../../shared/ramble/protocol';
import { rambleRoute, type ConnectUpstream, type RambleRoute } from './ramble';
import type { Socket, StreamEvents } from './sockets';
import { signUp, testApp, upload, type Session, type TestApp } from './test-app';

/** An upstream that starts at once and commits with no text, so a session ends as soon as it is asked to. */
const upstream: ConnectUpstream = async (_session, events) => {
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

type Opened = { sent: { type: string; reason?: string; seconds?: number; code?: string }[]; events: StreamEvents };

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

async function open(person = me.person): Promise<Opened> {
	pending = null;
	const request = new Request('https://procrastimate.test/api/ramble/socket', { headers: { Upgrade: 'websocket' } });
	await route(request, person);
	if (!pending) throw new Error('the route did not open a session');
	const sent: Opened['sent'] = [];
	const events = (pending as (socket: Socket) => StreamEvents)({
		send: text => sent.push(JSON.parse(text)),
		close() {},
	});
	await Bun.sleep(5);
	return { sent, events };
}

const second = new Uint8Array(RAMBLE_BYTES_PER_SECOND);
async function stream(session: Opened, seconds: number) {
	for (let i = 0; i < seconds; i++) session.events.message(second);
	await Bun.sleep(20);
	return session.sent.find(message => message.type === 'ended');
}

describe('the Ramble caps', () => {
	test('a frame past the session cap is cut at it and the session ends', async () => {
		const session = await open();
		expect(await stream(session, RAMBLE_SESSION_SECONDS + 1)).toEqual({
			type: 'ended',
			seconds: RAMBLE_SESSION_SECONDS,
			reason: 'session-limit',
		});
	});

	test('the daily cap holds for a session opened before the sessions that used the day up', async () => {
		const stale = await open();
		let streamed = RAMBLE_SESSION_SECONDS;
		while (streamed < RAMBLE_DAILY_SECONDS) {
			const session = await open();
			const ended = await stream(session, RAMBLE_SESSION_SECONDS);
			streamed += ended?.seconds ?? 0;
			session.events.close();
		}
		expect(streamed).toBe(RAMBLE_DAILY_SECONDS);
		expect(await stream(stale, 1)).toEqual({ type: 'ended', seconds: 0, reason: 'daily-limit' });
		const refused = await open();
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
		expect(session.sent.at(-1)).toEqual({ type: 'ended', seconds: 1, reason: 'idle' });
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
		await stream(session, 1);
		setSystemTime(new Date(Date.UTC(2026, 9, 20, 4, 0, 1)));
		await stream(session, 1);
		session.events.message(JSON.stringify({ type: 'stop' }));
		await Bun.sleep(20);
		expect(session.sent.at(-1)).toEqual({ type: 'ended', seconds: 2, reason: 'stopped' });
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
