import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { Server } from 'bun';
import { DEVICE_HEADER } from '../../../shared/auth';
import { CASSETTES } from '../../../shared/fixtures/ramble-audio/cassettes';
import {
	RAMBLE_FRAME_BYTES,
	RAMBLE_MAX_FRAME_BYTES,
	RAMBLE_SOCKET_PATH,
	RAMBLE_SOCKET_PROTOCOL,
	type RambleServerMessage,
} from '../../../shared/ramble/protocol';
import { startSync } from '../../../shared/sync/apply';
import { DEVICE_PROTOCOL_PREFIX, SYNC_SOCKET_PATH, type Snapshot } from '../../../shared/sync/protocol';
import { counter, label, project, snapshotOf, task } from '../../../shared/sync/testing';
import { addDays } from '../../../shared/task';
import { zonedDateKey, zonedTime } from '../../../shared/zoned-time';
import { TEST_AUTH_SECRET } from './test-device';
import { serveDev } from '../dev-server';
import {
	KEYTERM_TRIGGERS,
	MAX_KEYTERMS,
	rambleKeyterms,
	upstreamUrl,
	type ConnectUpstream,
	type RambleConfig,
	type UpstreamEvents,
} from './ramble';
import { memoryRambleBudget } from './ramble-budget';
import { cassetteUpstream } from './ramble-cassette';
import { durableSockets } from './realtime';

type Chunk = { message_type: string; audio_base_64: string; commit: boolean; sample_rate: number };

/** One fake ElevenLabs session: what the proxy sent it, and a way to answer. */
type FakeSession = {
	settings: { keyterms: string[]; cassette: string | null };
	sent: Chunk[];
	closed: boolean;
	emit(message: Record<string, unknown>): void;
};

/**
 * A fake ElevenLabs. Sessions start on their own unless `manualStart`, and a commit is answered with `finalText`.
 */
function fakeElevenLabs({ manualStart = false, finalText = 'final words' } = {}) {
	const sessions: FakeSession[] = [];
	const connect: ConnectUpstream = async (settings, events: UpstreamEvents) => {
		const session: FakeSession = {
			settings,
			sent: [],
			closed: false,
			emit: message => events.message(JSON.stringify(message)),
		};
		sessions.push(session);
		if (!manualStart) setTimeout(() => session.emit({ message_type: 'session_started', session_id: 's1', config: {} }));
		return {
			send(text) {
				const chunk = JSON.parse(text) as Chunk;
				session.sent.push(chunk);
				if (chunk.commit) setTimeout(() => session.emit({ message_type: 'committed_transcript', text: finalText }));
			},
			close: () => void (session.closed = true),
		};
	};
	return { connect, sessions };
}

async function until(check: () => boolean) {
	for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
	expect(check()).toBe(true);
}

/** A client socket that records what it hears. `opened` settles false when the server refuses the upgrade. */
function listen(socket: WebSocket) {
	const messages: RambleServerMessage[] = [];
	const opened = new Promise<boolean>(resolve => {
		socket.addEventListener('open', () => resolve(true));
		socket.addEventListener('close', () => resolve(false));
	});
	const closed = new Promise<CloseEvent>(resolve => socket.addEventListener('close', resolve));
	socket.addEventListener('message', ({ data }) => messages.push(JSON.parse(String(data))));
	return {
		socket,
		messages,
		opened,
		closed,
		async message(index: number) {
			await until(() => messages.length > index);
			return messages[index]!;
		},
		audio: (bytes: number, fill = 1) => socket.send(new Uint8Array(bytes).fill(fill)),
		stop: () => socket.send(JSON.stringify({ type: 'stop' })),
	};
}

const decode = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
const sentBytes = (session: FakeSession) =>
	session.sent.reduce((sum, chunk) => sum + decode(chunk.audio_base_64).length, 0);

describe('the Ramble socket on the dev server', () => {
	let server: Server<unknown>;
	const clients: WebSocket[] = [];

	afterEach(async () => {
		setSystemTime();
		for (const client of clients.splice(0)) client.close();
		await server.stop(true);
	});

	let session: { token: string; cookie: string } | null = null;

	function start(ramble: RambleConfig) {
		session = null;
		server = serveDev({ port: 0, ramble, env: { BETTER_AUTH_SECRET: TEST_AUTH_SECRET } }) as Server<unknown>;
	}

	const call = (method: string, path: string, init: RequestInit = {}) =>
		fetch(`http://127.0.0.1:${server.port}${path}`, { method, ...init });

	async function setup(name = 'Mac') {
		const origin = `http://127.0.0.1:${server.port}`;
		if (!session) {
			const response = await call('POST', '/api/auth/sign-up/email', {
				headers: { 'content-type': 'application/json', origin },
				body: JSON.stringify({
					email: `user-${crypto.randomUUID()}@procrastimate.test`,
					password: 'test-password-1',
					name,
				}),
			});
			if (!response.ok) throw new Error(await response.text());
			const token = response.headers.get('set-auth-token');
			if (!token) throw new Error('missing session token');
			session = {
				token,
				cookie: response.headers
					.getSetCookie()
					.map(value => value.split(';')[0])
					.join('; '),
			};
		}
		return { ...session, deviceId: crypto.randomUUID() };
	}

	async function upload(credentials: { deviceId: string; token: string }, snapshot: Snapshot) {
		const { outbox } = startSync(snapshot, credentials.deviceId, Date.now(), counter('op-'));
		const response = await call('POST', '/api/sync', {
			headers: {
				'content-type': 'application/json',
				Authorization: `Bearer ${credentials.token}`,
				[DEVICE_HEADER]: credentials.deviceId,
			},
			body: JSON.stringify({ cursor: 0, ops: outbox }),
		});
		expect(response.status).toBe(200);
	}

	/** Opens a socket the way the browser does, with the session cookie and device id, or with headers like iOS. */
	function connect(cred: { token: string; deviceId: string; cookie: string }, { header = false, query = '' } = {}) {
		const url = `ws://127.0.0.1:${server.port}${RAMBLE_SOCKET_PATH}${query}`;
		const socket = header
			? new WebSocket(url, {
					protocols: [RAMBLE_SOCKET_PROTOCOL],
					headers: { Authorization: `Bearer ${cred.token}`, [DEVICE_HEADER]: cred.deviceId },
				} as never)
			: new WebSocket(url, {
					protocols: [RAMBLE_SOCKET_PROTOCOL, `${DEVICE_PROTOCOL_PREFIX}${cred.deviceId}`],
					headers: { cookie: cred.cookie },
				} as never);
		clients.push(socket);
		return listen(socket);
	}

	test('refuses plain requests and missing tokens, and answers 503 without an upstream', async () => {
		start({ connect: fakeElevenLabs().connect });
		const cred = await setup();
		expect((await call('GET', RAMBLE_SOCKET_PATH, { headers: { Authorization: `Bearer ${cred.token}` } })).status).toBe(
			426,
		);
		{
			const refused = new WebSocket(`ws://127.0.0.1:${server.port}${RAMBLE_SOCKET_PATH}`, [RAMBLE_SOCKET_PROTOCOL]);
			clients.push(refused);
			expect(await listen(refused).opened).toBe(false);
		}
		await server.stop(true);

		start({ connect: null });
		const paired = await setup();
		expect(await connect(paired).opened).toBe(false);
		const upgrade = { Upgrade: 'websocket', Authorization: `Bearer ${paired.token}`, [DEVICE_HEADER]: paired.deviceId };
		expect((await call('GET', RAMBLE_SOCKET_PATH, { headers: upgrade })).status).toBe(503);
	});

	test('relays audio and transcripts, and ends with a final commit on stop', async () => {
		const upstream = fakeElevenLabs({ finalText: 'Call mom' });
		start({ connect: upstream.connect });
		const client = connect(await setup());
		expect(await client.opened).toBe(true);
		expect(client.socket.protocol).toBe(RAMBLE_SOCKET_PROTOCOL);
		expect(await client.message(0)).toEqual({ type: 'started' });

		client.audio(RAMBLE_FRAME_BYTES, 7);
		const [session] = upstream.sessions;
		await until(() => session!.sent.length === 1);
		session!.emit({ message_type: 'partial_transcript', text: 'Buy' });
		session!.emit({ message_type: 'partial_transcript', text: '' });
		session!.emit({ message_type: 'committed_transcript', text: 'Buy milk.' });
		session!.emit({ message_type: 'warning', warning: 'ignored' });
		await client.message(2);
		client.audio(RAMBLE_FRAME_BYTES, 9);
		await until(() => session!.sent.length === 2);
		expect(session!.sent.map(chunk => [chunk.message_type, chunk.commit, chunk.sample_rate])).toEqual([
			['input_audio_chunk', false, 16000],
			['input_audio_chunk', false, 16000],
		]);
		expect(decode(session!.sent[1]!.audio_base_64)).toEqual(new Uint8Array(RAMBLE_FRAME_BYTES).fill(9));
		client.stop();
		expect(await client.closed).toMatchObject({ code: 1000 });
		expect(session!.sent.at(-1)).toMatchObject({ audio_base_64: '', commit: true });
		expect(client.messages.slice(1)).toEqual([
			{ type: 'partial', text: 'Buy' },
			{ type: 'committed', text: 'Buy milk.' },
			{ type: 'committed', text: 'Call mom' },
			{ type: 'ended', seconds: 0.2, reason: 'stopped' },
		]);
		expect(session!.closed).toBe(true);
	});

	test('accepts the token as a header, buffers audio until the session starts, and skips an empty commit', async () => {
		const upstream = fakeElevenLabs({ manualStart: true });
		start({ connect: upstream.connect });
		const client = connect(await setup(), { header: true });
		expect(await client.opened).toBe(true);
		client.audio(RAMBLE_FRAME_BYTES);
		client.audio(RAMBLE_FRAME_BYTES);
		await until(() => upstream.sessions.length === 1);
		await Bun.sleep(20);
		const [session] = upstream.sessions;
		expect(session!.sent).toEqual([]);

		session!.emit({ message_type: 'session_started', session_id: 's1', config: {} });
		await until(() => session!.sent.length === 2);
		session!.emit({ message_type: 'committed_transcript', text: 'Buy milk.' });
		await client.message(1);
		client.stop();
		await client.closed;
		expect(session!.sent.some(chunk => chunk.commit)).toBe(false);
		expect(client.messages).toEqual([
			{ type: 'started' },
			{ type: 'committed', text: 'Buy milk.' },
			{ type: 'ended', seconds: 0.2, reason: 'stopped' },
		]);
	});

	test('sends keyterms from synced names, most recently used first', async () => {
		const upstream = fakeElevenLabs();
		start({ connect: upstream.connect });
		const mac = await setup();
		await upload(
			mac,
			snapshotOf({
				projects: [project('p1', { name: 'Home' }), project('p2', { name: 'Work' })],
				labels: [label('l1', { name: 'calls' }), label('l2', { name: 'a label far longer than twenty' })],
				tasks: [task('t1', { projectId: 'p2', createdAt: 5 }), task('t2', { labelIds: ['l1'], createdAt: 9 })],
			}),
		);
		const client = connect(mac);
		await client.message(0);
		expect(upstream.sessions[0]!.settings.keyterms).toEqual([...KEYTERM_TRIGGERS, 'calls', 'Work', 'Home']);
	});

	test('stops every account at the global daily budget and returns unused time', async () => {
		const upstream = fakeElevenLabs();
		setSystemTime(Date.UTC(2026, 9, 14, 12));
		start({
			connect: upstream.connect,
			limits: { sessionSeconds: 100, dailySeconds: 100 },
			budget: memoryRambleBudget(0.3),
		});
		const cred = await setup();

		const first = connect(cred);
		await first.message(0);
		first.audio(RAMBLE_FRAME_BYTES);
		first.audio(RAMBLE_FRAME_BYTES);
		first.stop();
		await first.closed;
		expect(first.messages.at(-1)).toEqual({ type: 'ended', seconds: 0.2, reason: 'stopped' });

		const second = connect(cred);
		await second.message(0);
		second.audio(RAMBLE_FRAME_BYTES);
		second.audio(RAMBLE_FRAME_BYTES);
		await second.closed;
		expect(sentBytes(upstream.sessions[1]!)).toBe(RAMBLE_FRAME_BYTES);
		expect(second.messages.at(-1)).toEqual({ type: 'ended', seconds: 0.1, reason: 'daily-limit' });

		const third = connect(cred);
		const midnight = zonedTime(addDays(zonedDateKey(Date.now(), 'UTC'), 1), '00:00', 'UTC');
		expect(await third.message(0)).toEqual({
			type: 'error',
			code: 'daily-limit',
			message: "Ramble's daily limit is used up",
			resetsAt: midnight,
		});
		expect(upstream.sessions).toHaveLength(2);
	});

	test('refuses Ramble when the global budget cannot be reserved', async () => {
		start({
			connect: fakeElevenLabs().connect,
			budget: { reserve: () => Promise.reject(new Error('turso down')), release: async () => {} },
		});
		const cred = await setup();
		const upgrade = { Upgrade: 'websocket', Authorization: `Bearer ${cred.token}`, [DEVICE_HEADER]: cred.deviceId };
		expect((await call('GET', RAMBLE_SOCKET_PATH, { headers: upgrade })).status).toBe(503);
	});

	test('cuts the frame that reaches the session cap and ends the session', async () => {
		const upstream = fakeElevenLabs();
		start({ connect: upstream.connect, limits: { sessionSeconds: 0.15, dailySeconds: 100 } });
		const client = connect(await setup());
		await client.message(0);
		client.audio(RAMBLE_FRAME_BYTES);
		client.audio(RAMBLE_FRAME_BYTES);
		client.audio(RAMBLE_FRAME_BYTES);
		await client.closed;
		expect(sentBytes(upstream.sessions[0]!)).toBe(RAMBLE_FRAME_BYTES * 1.5);
		expect(client.messages.at(-1)).toMatchObject({ type: 'ended', reason: 'session-limit' });
	});

	test('counts seconds per day, cuts at the daily cap, and refuses sessions once it is used up', async () => {
		const upstream = fakeElevenLabs();
		start({ connect: upstream.connect, limits: { sessionSeconds: 100, dailySeconds: 0.3 } });
		const cred = await setup();

		const first = connect(cred);
		await first.message(0);
		first.audio(RAMBLE_FRAME_BYTES);
		first.audio(RAMBLE_FRAME_BYTES);
		await until(() => upstream.sessions[0]!.sent.length === 2);
		first.stop();
		await first.closed;
		expect(first.messages.at(-1)).toEqual({ type: 'ended', seconds: 0.2, reason: 'stopped' });

		const second = connect(cred);
		await second.message(0);
		second.audio(RAMBLE_FRAME_BYTES);
		second.audio(RAMBLE_FRAME_BYTES);
		await second.closed;
		expect(sentBytes(upstream.sessions[1]!)).toBe(RAMBLE_FRAME_BYTES);
		expect(second.messages.at(-1)).toEqual({ type: 'ended', seconds: 0.1, reason: 'daily-limit' });

		const third = connect(cred);
		expect(await third.opened).toBe(true);
		await third.closed;
		const midnight = zonedTime(addDays(zonedDateKey(Date.now(), 'UTC'), 1), '00:00', 'UTC');
		expect(third.messages).toEqual([
			{ type: 'error', code: 'daily-limit', message: "Ramble's daily limit is used up", resetsAt: midnight },
		]);
		expect(upstream.sessions).toHaveLength(2);
	});

	test('charges audio after midnight to the new day', async () => {
		const upstream = fakeElevenLabs();
		setSystemTime(Date.UTC(2026, 9, 14, 23, 59, 30));
		start({ connect: upstream.connect, limits: { sessionSeconds: 100, dailySeconds: 0.2 } });
		const cred = await setup();
		const client = connect(cred);
		await client.message(0);
		client.audio(RAMBLE_FRAME_BYTES);
		await until(() => upstream.sessions[0]!.sent.length === 1);

		setSystemTime(Date.UTC(2026, 9, 15, 0, 0, 30));
		client.audio(RAMBLE_FRAME_BYTES);
		client.audio(RAMBLE_FRAME_BYTES);
		await client.closed;
		expect(sentBytes(upstream.sessions[0]!)).toBe(RAMBLE_FRAME_BYTES * 3);
		expect(client.messages.at(-1)).toEqual({ type: 'ended', seconds: 0.3, reason: 'daily-limit' });

		const next = connect(cred);
		expect(await next.message(0)).toMatchObject({ type: 'error', code: 'daily-limit' });
		expect(upstream.sessions).toHaveLength(1);
	});

	test('ends a quiet socket on its own, and audio restarts that wait', async () => {
		const upstream = fakeElevenLabs();
		start({ connect: upstream.connect, limits: { sessionSeconds: 100, dailySeconds: 100, idleMs: 300 } });
		const client = connect(await setup());
		await client.message(0);
		for (let i = 0; i < 5; i++) {
			client.audio(RAMBLE_FRAME_BYTES);
			await Bun.sleep(100);
		}
		await until(() => upstream.sessions[0]!.sent.length === 5);
		await client.closed;
		expect(client.messages.at(-1)).toEqual({ type: 'ended', seconds: 0.5, reason: 'idle' });
		expect(upstream.sessions[0]!.closed).toBe(true);
	});

	test('counts a session the client leaves, and closes its upstream', async () => {
		const upstream = fakeElevenLabs();
		start({ connect: upstream.connect, limits: { sessionSeconds: 100, dailySeconds: 0.3 } });
		const cred = await setup();
		const client = connect(cred);
		await client.message(0);
		client.audio(RAMBLE_FRAME_BYTES);
		client.audio(RAMBLE_FRAME_BYTES);
		await until(() => upstream.sessions[0]!.sent.length === 2);
		client.socket.close();
		await until(() => upstream.sessions[0]!.closed);

		const next = connect(cred);
		await next.message(0);
		next.audio(RAMBLE_FRAME_BYTES);
		next.audio(RAMBLE_FRAME_BYTES);
		await next.closed;
		expect(sentBytes(upstream.sessions[1]!)).toBe(RAMBLE_FRAME_BYTES);
		expect(next.messages.at(-1)).toMatchObject({ type: 'ended', reason: 'daily-limit' });
	});

	test('relays an upstream error, a failed connection, and refuses oversized frames', async () => {
		const upstream = fakeElevenLabs();
		let refuse = false;
		start({
			connect: (settings, events) => (refuse ? Promise.reject(new Error('down')) : upstream.connect(settings, events)),
		});
		const cred = await setup();

		const quota = connect(cred);
		await quota.message(0);
		upstream.sessions[0]!.emit({ message_type: 'quota_exceeded', error: 'Out of credits' });
		await quota.closed;
		expect(quota.messages.slice(1)).toEqual([
			{ type: 'error', code: 'upstream', message: 'quota_exceeded: Out of credits' },
			{ type: 'ended', seconds: 0, reason: 'error' },
		]);

		const large = connect(cred);
		await large.message(0);
		large.audio(RAMBLE_MAX_FRAME_BYTES + 2);
		await large.closed;
		expect(large.messages.slice(1).map(message => message.type)).toEqual(['error', 'ended']);
		expect(large.messages[1]).toMatchObject({ code: 'invalid-audio' });

		refuse = true;
		const down = connect(cred);
		await down.closed;
		expect(down.messages).toEqual([
			{ type: 'error', code: 'upstream', message: 'Could not reach the transcription service' },
			{ type: 'ended', seconds: 0, reason: 'error' },
		]);
	});

	test('keeps Ramble sockets out of the sync nudge', async () => {
		start({ connect: fakeElevenLabs().connect });
		const mac = await setup();
		const client = connect(mac);
		await client.message(0);
		await upload(mac, snapshotOf({ projects: [project('p1', { name: 'Home' })] }));
		const nudge = new WebSocket(`ws://127.0.0.1:${server.port}${SYNC_SOCKET_PATH}`, {
			protocols: ['procrastimate.sync', `${DEVICE_PROTOCOL_PREFIX}${mac.deviceId}`],
			headers: { cookie: mac.cookie },
		} as never);
		clients.push(nudge);
		await Bun.sleep(20);
		expect(client.messages).toEqual([{ type: 'started' }]);
	});

	test('replays the default cassette, flushing what is left on stop', async () => {
		start({ connect: cassetteUpstream() });
		const client = connect(await setup());
		expect(await client.message(0)).toEqual({ type: 'started' });
		client.audio(RAMBLE_FRAME_BYTES);
		await Bun.sleep(10);
		client.stop();
		await client.closed;
		const committed = client.messages.filter(message => message.type === 'committed').map(message => message.text);
		expect(committed.join(' ')).toBe(CASSETTES['three-tasks']!.transcript);
		expect(client.messages.at(-1)).toEqual({ type: 'ended', seconds: 0.1, reason: 'stopped' });
	});

	test('refuses an unknown cassette', async () => {
		start({ connect: cassetteUpstream() });
		const client = connect(await setup(), { query: '?cassette=missing' });
		await client.closed;
		expect(client.messages[0]).toMatchObject({ type: 'error', code: 'upstream' });
	});
});

describe('the cassette upstream', () => {
	test('starts at once, plays from the first audio, and answers an empty commit', async () => {
		const heard: Record<string, unknown>[] = [];
		const cassettes = {
			short: {
				id: 'short',
				transcript: 'Hi.',
				events: [
					{ afterAudioMs: 5, message: { message_type: 'partial_transcript', text: 'Hi' } },
					{ afterAudioMs: 10, message: { message_type: 'committed_transcript', text: 'Hi.' } },
				],
			},
		};
		const upstream = await cassetteUpstream(cassettes)(
			{ keyterms: [], cassette: 'short' },
			{ message: text => void heard.push(JSON.parse(text)), close() {} },
		);
		await until(() => heard.length === 1);
		expect(heard[0]).toMatchObject({ message_type: 'session_started' });
		await Bun.sleep(20);
		expect(heard).toHaveLength(1);

		upstream.send(JSON.stringify({ audio_base_64: 'AAA=', commit: false }));
		await until(() => heard.length === 3);
		expect(heard.slice(1).map(message => message.text)).toEqual(['Hi', 'Hi.']);
		upstream.send(JSON.stringify({ audio_base_64: '', commit: true }));
		await until(() => heard.length === 4);
		expect(heard[3]).toEqual({ message_type: 'committed_transcript', text: '' });
		upstream.close();
	});
});

describe('upstream settings', () => {
	test('pins the model, format, VAD commits, English, and no verbatim, with each keyterm as a parameter', () => {
		const url = new URL(upstreamUrl(['subtask', 'Side Project']));
		expect(`${url.origin}${url.pathname}`).toBe('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
		expect(Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'keyterms'))).toEqual({
			model_id: 'scribe_v2_realtime',
			audio_format: 'pcm_16000',
			commit_strategy: 'vad',
			vad_silence_threshold_secs: '1.0',
			language_code: 'en',
			no_verbatim: 'true',
		});
		expect(url.searchParams.getAll('keyterms')).toEqual(['subtask', 'Side Project']);
	});

	test('keyterms skip long names and duplicates, and stop at fifty', () => {
		const projects = Array.from({ length: 60 }, (_, i) =>
			project(`p${i}`, { name: `Project ${String(i).padStart(2, '0')}` }),
		);
		const terms = rambleKeyterms({
			projects: [project('dup', { name: 'Priority' }), ...projects],
			labels: [label('long', { name: 'x'.repeat(21) }), label('edge', { name: 'y'.repeat(20) })],
			tasks: [],
		});
		expect(terms).toHaveLength(MAX_KEYTERMS);
		expect(terms.slice(0, 7)).toEqual([...KEYTERM_TRIGGERS, 'Project 00', 'Project 01']);
		expect(terms).not.toContain('Priority');
		expect(terms.some(term => term.length > 20)).toBe(false);
	});
});

describe('Ramble sockets on the Worker', () => {
	const runtime = globalThis as Record<string, unknown>;

	afterEach(() => {
		delete runtime.WebSocketPair;
		delete runtime.WebSocketRequestResponsePair;
	});

	test('accepts the server end before the session sends, answers 101 with the protocol, and feeds it bytes', () => {
		const log: string[] = [];
		const listeners: Record<string, (event: { data?: unknown }) => void> = {};
		const server = {
			accept: () => void log.push('accept'),
			send: (message: string) => void log.push(`send ${message}`),
			addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => (listeners[type] = listener),
		};
		runtime.WebSocketRequestResponsePair = class {};
		runtime.WebSocketPair = class {
			0 = {};
			1 = server;
		};
		const state = { setWebSocketAutoResponse() {} };
		const heard: unknown[] = [];
		const response = durableSockets(state as never).stream(
			new Request('https://x.test'),
			RAMBLE_SOCKET_PROTOCOL,
			socket => {
				socket.send('hello');
				return { message: data => void heard.push(data), close: () => void heard.push('closed') };
			},
		);
		expect(response.status).toBe(101);
		expect(response.headers.get('Sec-WebSocket-Protocol')).toBe(RAMBLE_SOCKET_PROTOCOL);
		expect(log).toEqual(['accept', 'send hello']);
		listeners.message!({ data: new Uint8Array([1, 2]).buffer });
		listeners.message!({ data: '{"type":"stop"}' });
		listeners.close!({});
		expect(heard).toEqual([new Uint8Array([1, 2]), '{"type":"stop"}', 'closed']);
	});
});
