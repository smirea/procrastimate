import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { INSTALL_GATE } from '../../../shared/auth';
import { formatHlc } from '../../../shared/sync/hlc';
import {
	SOCKET_PING,
	SOCKET_PONG,
	SOCKET_REVOKED,
	SOCKET_TOKEN_PREFIX,
	SYNC_SOCKET_PATH,
	SYNC_SOCKET_PROTOCOL,
	type Op,
	type SyncResponse,
} from '../../../shared/sync/protocol';
import { serveDev } from '../dev-server';
import { durableSockets, realtime } from './realtime';

/** A client socket that records what it hears. `opened` settles false when the server refuses the upgrade. */
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
		/** Resolves with the next message, or the one already waiting at `index`. */
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
		server = serveDev({ port: 0 }) as Server<unknown>;
		base = `http://127.0.0.1:${server.port}`;
	});

	afterEach(async () => {
		for (const client of clients.splice(0)) client.close();
		await server.stop(true);
	});

	const call = (method: string, path: string, token: string | null, body?: unknown) =>
		fetch(`${base}${path}`, {
			method,
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: body === undefined ? undefined : JSON.stringify(body),
		});

	async function setup(name: string) {
		const token = `token-${crypto.randomUUID()}`;
		const response = await call('POST', '/api/auth/register', null, {
			gate: INSTALL_GATE,
			deviceId: crypto.randomUUID(),
			token,
			name,
		});
		const body = (await response.json()) as { deviceId: string };
		return { deviceId: body.deviceId, token };
	}

	let ops = 0;
	async function push(token: string, cursor: number, title?: string) {
		const op = { opId: `op-${++ops}`, hlc: formatHlc({ wall: Date.now(), counter: ops, node: 'dev' }) };
		const body = { cursor, ops: title ? [{ ...op, kind: 'task', id: `t${ops}`, fields: { title } } as Op] : [] };
		return (await (await call('POST', '/api/sync', token, body)).json()) as SyncResponse;
	}

	/** Opens a socket the way the browser does, with the token as a subprotocol. */
	function connect(token: string, init?: { headers: Record<string, string> }) {
		const url = `ws://127.0.0.1:${server.port}${SYNC_SOCKET_PATH}`;
		const socket = init
			? // Bun's client takes headers, as the iOS one can; the DOM typing the root config loads does not know them.
				new WebSocket(url, { protocols: [SYNC_SOCKET_PROTOCOL], ...init } as never)
			: new WebSocket(url, [SYNC_SOCKET_PROTOCOL, `${SOCKET_TOKEN_PREFIX}${token}`]);
		clients.push(socket);
		return listen(socket);
	}

	test('refuses a socket without a live token and a plain request', async () => {
		expect(await connect('not-a-token').opened).toBe(false);
		expect(await connect('').opened).toBe(false);
		expect((await call('GET', SYNC_SOCKET_PATH, (await setup('Mac')).token)).status).toBe(426);
	});

	test('accepts the token as a subprotocol or a header, and answers the keepalive', async () => {
		const { token } = await setup('Mac');
		const browser = connect(token);
		expect(await browser.opened).toBe(true);
		expect(browser.socket.protocol).toBe(SYNC_SOCKET_PROTOCOL);
		const native = connect('', { headers: { Authorization: `Bearer ${token}` } });
		expect(await native.opened).toBe(true);
		browser.socket.send(SOCKET_PING);
		expect(await browser.message(0)).toBe(SOCKET_PONG);
	});

	test('sends the new head to every socket after a push that moved the log, and nothing otherwise', async () => {
		const mac = await setup('Mac');
		const phone = await setup('Phone');
		const macSocket = connect(mac.token);
		const phoneSocket = connect(phone.token);
		expect(await macSocket.opened).toBe(true);
		expect(await phoneSocket.opened).toBe(true);

		const first = await push(mac.token, 0, 'Buy milk');
		expect(JSON.parse(await phoneSocket.message(0))).toEqual({ cursor: first.cursor });
		expect(JSON.parse(await macSocket.message(0))).toEqual({ cursor: first.cursor });

		await push(phone.token, first.cursor);
		const second = await push(phone.token, first.cursor, 'Call mom');
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
