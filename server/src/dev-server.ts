import type { Server, ServerWebSocket } from 'bun';
import { SOCKET_PING, SOCKET_PONG } from '../../shared/sync/protocol';
import { accountHandler } from './account/account';
import { memoryStore } from './account/memory-store';
import { tursoSession } from './account/turso';
import { upstreamUrl, type ConnectUpstream, type RambleConfig } from './account/ramble';
import { acceptedProtocol, type Socket, type SocketHost, type StreamEvents } from './account/realtime';
import api from './api';
import type { Env } from './bindings';

/** A nudge socket carries its device; a streaming socket carries the `start` its route passed, then its handlers. */
type SocketData =
	| { kind: 'nudge'; deviceId: string }
	| { kind: 'stream'; start: (socket: Socket) => StreamEvents; events?: StreamEvents };

/** ElevenLabs from Bun, whose `WebSocket` client can set the key header. */
export function bunUpstream(apiKey: string): ConnectUpstream {
	return ({ keyterms }, events) =>
		new Promise((resolve, reject) => {
			// Bun's client takes headers; the DOM typing the root config loads does not know them.
			const socket = new WebSocket(upstreamUrl(keyterms), { headers: { 'xi-api-key': apiKey } } as never);
			socket.addEventListener('open', () =>
				resolve({ send: text => socket.send(text), close: () => socket.close(1000, 'Done') }),
			);
			socket.addEventListener('message', ({ data }) => typeof data === 'string' && events.message(data));
			socket.addEventListener('close', () => {
				reject(new Error('ElevenLabs refused the connection'));
				events.close();
			});
		});
}

/**
 * The Bun dev server: the Worker's handler over one in-memory account, with the nudge and Ramble sockets on Bun's
 * WebSocket server. Bun upgrades through `server.upgrade` and needs the fetch handler to answer nothing, so an
 * accepted upgrade returns a marker response that `fetch` swaps for `undefined`.
 */
export function serveDev({
	port,
	turso,
	ramble = { connect: null },
}: {
	port: number;
	/** When both Turso secrets are set, task data lives there. Otherwise the account stays in memory. */
	turso?: { url: string; authToken: string };
	ramble?: RambleConfig;
}) {
	const open = new Set<ServerWebSocket<SocketData>>();
	const upgraded = new WeakSet<Response>();
	let server: Server<SocketData> | undefined;
	const upgrade = (request: Request, data: SocketData, protocol: string) => {
		if (!server?.upgrade(request, { data, headers: { 'Sec-WebSocket-Protocol': protocol } })) {
			return Response.json({ ok: false, error: 'Upgrade failed' }, { status: 400 });
		}
		const marker = new Response(null);
		upgraded.add(marker);
		return marker;
	};
	const sockets: SocketHost = {
		accept: (request, deviceId) =>
			upgrade(request, { kind: 'nudge', deviceId }, acceptedProtocol['Sec-WebSocket-Protocol']),
		sockets: deviceId =>
			[...open].filter(socket => socket.data.kind === 'nudge' && (!deviceId || socket.data.deviceId === deviceId)),
		stream: (request, protocol, start) => upgrade(request, { kind: 'stream', start }, protocol),
	};
	const memories = new Map<string, ReturnType<typeof memoryStore>>();
	const memoryFor = (id: string) => {
		const existing = memories.get(id);
		if (existing) return existing;
		const created = memoryStore();
		memories.set(id, created);
		return created;
	};
	const handle = accountHandler(async () => {}, sockets, ramble);
	// End-to-end sharding stays in memory even when the shell has Turso credentials.
	const database = turso && !process.env.E2E_SHARD ? turso : undefined;
	let tail = Promise.resolve();
	const accountFetch = (id: string, request: Request) => {
		if (!database) return handle(request, memoryFor(id));
		const run = tail.then(async () => {
			const session = await tursoSession(database.url, database.authToken);
			try {
				return await handle(request, session.store);
			} finally {
				await session.flush();
			}
		});
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};
	const bindings = {
		E2E_SHARD: process.env.E2E_SHARD,
		ACCOUNT: {
			idFromName: (name: string) => name,
			get: (id: string) => ({ fetch: (request: Request) => accountFetch(id, request) }),
		},
	};

	server = Bun.serve<SocketData>({
		development: true,
		idleTimeout: 120,
		port,
		async fetch(request) {
			const response = await api.fetch(request, bindings as unknown as Env);
			return upgraded.has(response) ? undefined : response;
		},
		websocket: {
			open(socket) {
				if (socket.data.kind === 'nudge') open.add(socket);
				else socket.data.events = socket.data.start(socket);
			},
			close(socket) {
				open.delete(socket);
				if (socket.data.kind === 'stream') socket.data.events?.close();
			},
			message(socket, message) {
				if (socket.data.kind === 'stream') {
					socket.data.events?.message(typeof message === 'string' ? message : new Uint8Array(message));
				} else if (message === SOCKET_PING) socket.send(SOCKET_PONG);
			},
		},
	});
	return server;
}
