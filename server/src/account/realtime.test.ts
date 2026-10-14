import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { DEVICE_HEADER } from '../../../shared/auth';
import { formatHlc } from '../../../shared/sync/hlc';
import {
	DEVICE_PROTOCOL_PREFIX,
	SOCKET_PING,
	SOCKET_PONG,
	SOCKET_REVOKED,
	SYNC_SOCKET_PATH,
	SYNC_SOCKET_PROTOCOL,
	type Op,
	type SyncResponse,
} from '../../../shared/sync/protocol';
import { TEST_AUTH_SECRET } from './test-device';
import { serveDev } from '../dev-server';
import { durableSockets, realtime } from './realtime';

function listen(socket: WebSocket) {
	const messages: string[] = [];
	const opened = new Promise<boolean>(resolve => {
		socket.addEventListener('open', () => resolve(true));
		socket.addEventListener('close', () => resolve(false));
	});
	const closed = new Promise<CloseEvent>(resolve => socket.addEventListener('close', resolve));
	let waiter: (() => void) | undefined;
	socket.addEventListener('message', ({ data }) => {
		messages.push(String(data));
		waiter?.();
	});
	return {
		socket,
		messages,
		opened,
		closed,
		async message(index: number) {
			while (messages.length <= index) await new Promise<void>(resolve => (waiter = resolve));
			return messages[index]!;
		},
	};
}

describe('the realtime nudge on the dev server', () => {
	let server: Server<unknown>;
	let base: string;
	const clients: WebSocket[] = [];

	beforeEach(() => {
		server = serveDev({ port: 0, env: { BETTER_AUTH_SECRET: TEST_AUTH_SECRET } }) as Server<unknown>;
		base = `http://127.0.0.1:${server.port}`;
		session = null;
	});

	afterEach(async () => {
		for (const client of clients.splice(0)) client.close();
		await server.stop(true);
	});

	let session: { token: string; cookie: string } | null = null;

	const call = (method: string, path: string, cred: { token: string; deviceId: string } | null, body?: unknown) =>
		fetch(`${base}${path}`, {
			method,
			headers: cred
				? {
						'content-type': 'application/json',
						Authorization: `Bearer ${cred.token}`,
						[DEVICE_HEADER]: cred.deviceId,
						origin: base,
					}
				: { 'content-type': 'application/json', origin: base },
			body: body === undefined ? undefined : JSON.stringify(body),
		});

	async function setup(name: string) {
		if (!session) {
			const response = await fetch(`${base}/api/auth/sign-up/email`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: base },
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
		const deviceId = crypto.randomUUID();
		const cred = { ...session, deviceId };
		const synced = await call('POST', '/api/sync', cred, { cursor: 0, ops: [] });
		if (!synced.ok) throw new Error(await synced.text());
		return cred;
	}

	let ops = 0;
	async function push(cred: { token: string; deviceId: string }, cursor: number, title?: string) {
		const op = { opId: `op-${++ops}`, hlc: formatHlc({ wall: Date.now(), counter: ops, node: 'dev' }) };
		const body = { cursor, ops: title ? [{ ...op, kind: 'task', id: `t${ops}`, fields: { title } } as Op] : [] };
		return (await (await call('POST', '/api/sync', cred, body)).json()) as SyncResponse;
	}

	/** Opens a socket the way the browser does, with the session cookie and the device id as a subprotocol. */
	function connect(cred: { token: string; deviceId: string; cookie: string } | null, header = false) {
		const url = `ws://127.0.0.1:${server.port}${SYNC_SOCKET_PATH}`;
		const protocols = cred
			? [SYNC_SOCKET_PROTOCOL, `${DEVICE_PROTOCOL_PREFIX}${cred.deviceId}`]
			: [SYNC_SOCKET_PROTOCOL];
		const socket = header
			? new WebSocket(url, {
					protocols: [SYNC_SOCKET_PROTOCOL],
					headers: cred ? { Authorization: `Bearer ${cred.token}`, [DEVICE_HEADER]: cred.deviceId } : {},
				} as never)
			: new WebSocket(url, {
					protocols,
					headers: cred?.cookie ? { cookie: cred.cookie } : {},
				} as never);
		clients.push(socket);
		return listen(socket);
	}

	test('refuses a socket without a session and a plain request', async () => {
		expect(await connect(null).opened).toBe(false);
		const cred = await setup('Mac');
		expect((await call('GET', SYNC_SOCKET_PATH, cred)).status).toBe(426);
	});

	test('accepts the session as a cookie or a bearer header, and answers the keepalive', async () => {
		const cred = await setup('Mac');
		const browser = connect(cred);
		expect(await browser.opened).toBe(true);
		expect(browser.socket.protocol).toBe(SYNC_SOCKET_PROTOCOL);
		const native = connect(cred, true);
		expect(await native.opened).toBe(true);
		browser.socket.send(SOCKET_PING);
		expect(await browser.message(0)).toBe(SOCKET_PONG);
	});

	test('sends the new head to every socket after a push that moved the log, and nothing otherwise', async () => {
		const mac = await setup('Mac');
		const phone = await setup('Phone');
		const macSocket = connect(mac);
		const phoneSocket = connect(phone);
		expect(await macSocket.opened).toBe(true);
		expect(await phoneSocket.opened).toBe(true);

		const first = await push(mac, 0, 'Buy milk');
		expect(JSON.parse(await phoneSocket.message(0))).toEqual({ cursor: first.cursor });
		expect(JSON.parse(await macSocket.message(0))).toEqual({ cursor: first.cursor });

		await push(phone, first.cursor);
		const second = await push(phone, first.cursor, 'Call mom');
		expect(second.cursor).toBeGreaterThan(first.cursor);
		expect(JSON.parse(await macSocket.message(1))).toEqual({ cursor: second.cursor });
	});
});

describe('the realtime nudge on the Durable Object', () => {
	const runtime = globalThis as Record<string, unknown>;

	beforeEach(() => {
		runtime.WebSocketRequestResponsePair = class {
			constructor(
				readonly request: string,
				readonly response: string,
			) {}
		};
	});

	afterEach(() => {
		delete runtime.WebSocketRequestResponsePair;
	});

	/** A stand-in for the hibernation API: sockets with their tags, and what each was sent. */
	function fakeState() {
		const accepted: { tags: string[]; sent: string[]; closed?: number }[] = [];
		const state = {
			autoResponse: undefined as unknown,
			setWebSocketAutoResponse: (pair: unknown) => void (state.autoResponse = pair),
			acceptWebSocket: () => {},
			getWebSockets: (tag?: string) =>
				accepted
					.filter(socket => !tag || socket.tags.includes(tag))
					.map(socket => ({
						send: (message: string) => void socket.sent.push(message),
						close: (code: number) => void (socket.closed = code),
					})),
		};
		return { state, accepted };
	}

	test('answers the keepalive without waking, nudges every socket, and closes only the removed device', () => {
		const { state, accepted } = fakeState();
		const live = realtime(durableSockets(state as never));
		expect(state.autoResponse).toEqual({ request: SOCKET_PING, response: SOCKET_PONG });
		accepted.push({ tags: ['mac'], sent: [] }, { tags: ['phone'], sent: [] });

		live.nudge(7);
		expect(accepted.map(socket => socket.sent)).toEqual([['{"cursor":7}'], ['{"cursor":7}']]);
		live.revoke('phone');
		expect(accepted.map(socket => socket.closed)).toEqual([undefined, SOCKET_REVOKED]);
	});
});
