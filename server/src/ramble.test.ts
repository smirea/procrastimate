import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { RAMBLE_BYTES_PER_SECOND, RAMBLE_DAILY_SECONDS, RAMBLE_SESSION_SECONDS } from '../../shared/ramble/protocol';
import { ramble, rambleRoute, type ConnectUpstream, type RambleRoute } from './ramble';
import type { Socket, StreamEvents } from './sockets';
import { signUp, testApp, type Session, type TestApp } from './test-app';

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
	const host = ramble(
		(_request, _protocol, start) => {
			pending = start;
			return new Response(null);
		},
		{ connect: upstream },
	);
	route = rambleRoute(app.db, host);
});
afterAll(() => app.close());

async function open(): Promise<Opened> {
	pending = null;
	const request = new Request('https://procrastimate.test/api/ramble/socket', { headers: { Upgrade: 'websocket' } });
	await route(request, me.person);
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
