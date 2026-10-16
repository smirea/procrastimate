import type { Server, ServerWebSocket } from 'bun';
import { SOCKET_PING, SOCKET_PONG } from '../../shared/sync/protocol';
import { accountHandler, isNudge } from './account/account';
import { databaseImages, isImageRoute, memoryImages, type ImageStore } from './account/images';
import { memoryStore } from './account/memory-store';
import { upstreamUrl, type ConnectUpstream, type RambleConfig } from './account/ramble';
import { queuedRambleLedger, type RambleLedger } from './account/ramble-ledger';
import { acceptedProtocol, type Socket, type SocketHost, type StreamEvents } from './account/realtime';
import { serialQueue } from './account/serial';
import type { AccountStore } from './account/store';
import { tursoSession, writeUserRamble } from './account/turso';
import { tursoDatabase } from './db/turso';
import { originalRequest } from './actor';
import api from './api';
import type { Env } from './bindings';
import { config } from './config';

type SocketData =
	| { kind: 'nudge'; space: string; deviceId: string }
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
	ramble = { connect: null },
	env,
}: {
	port: number;
	ramble?: RambleConfig;
	/** Every binding but `ACCOUNT`, which the dev server supplies. */
	env: Omit<Env, 'ACCOUNT'>;
}) {
	const database = config(env).turso;
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
	// One Bun server carries every space's sockets, so each space's host sees only its own, as a Durable Object does.
	const socketsFor = (space: string): SocketHost => ({
		accept: (request, deviceId) =>
			upgrade(originalRequest(request), { kind: 'nudge', space, deviceId }, acceptedProtocol['Sec-WebSocket-Protocol']),
		sockets: deviceId =>
			[...open].filter(
				socket =>
					socket.data.kind === 'nudge' &&
					socket.data.space === space &&
					(!deviceId || socket.data.deviceId === deviceId),
			),
		stream: (request, protocol, start) => upgrade(originalRequest(request), { kind: 'stream', start }, protocol),
	});
	const memories = new Map<string, ReturnType<typeof memoryStore>>();
	const memoryFor = (id: string) => {
		const existing = memories.get(id);
		if (existing) return existing;
		const created = memoryStore();
		memories.set(id, created);
		return created;
	};
	const handlers = new Map<string, ReturnType<typeof accountHandler>>();
	const handleFor = (id: string) => {
		const existing = handlers.get(id);
		if (existing) return existing;
		const created = accountHandler(
			async () => {},
			socketsFor(id),
			ramble,
			() => bindings.ACCOUNT,
		);
		handlers.set(id, created);
		return created;
	};
	const queues = new Map<string, ReturnType<typeof serialQueue>>();
	const ledgers = new Map<string, RambleLedger>();
	const queueFor = (id: string) => {
		const existing = queues.get(id);
		if (existing) return existing;
		const created = serialQueue();
		queues.set(id, created);
		return created;
	};
	const ledgerFor = (id: string) => {
		const existing = ledgers.get(id);
		if (existing) return existing;
		const created = queuedRambleLedger(
			task => queueFor(id)(task),
			rows => {
				if (!database) return Promise.resolve();
				return writeUserRamble(database, id, rows);
			},
		);
		ledgers.set(id, created);
		return created;
	};
	const images = new Map<string, ImageStore>();
	const imagesFor = (id: string) => {
		const existing = images.get(id);
		if (existing) return existing;
		const created = database ? databaseImages(() => tursoDatabase(database), id) : memoryImages();
		images.set(id, created);
		return created;
	};
	const withStore = async <T>(id: string, use: (store: AccountStore) => Promise<T>) => {
		if (!database) return use(memoryFor(id));
		const session = await tursoSession(database, id, ledgerFor(id));
		try {
			return await use(session.store);
		} finally {
			await session.flush();
		}
	};
	// Like the Worker: one request per space at a time, calls to other spaces after the slot, nudges and the owner's
	// images outside it.
	const accountFetch = async (id: string, request: Request) => {
		const handle = handleFor(id);
		if (isNudge(request)) return handle.relay(request);
		const queue = queueFor(id);
		if (isImageRoute(request)) {
			return handle.images(request, {
				images: imagesFor(id),
				space: id,
				open: use => queue(() => withStore(id, use)),
			});
		}
		const deferred: Array<() => Promise<void>> = [];
		const response = await queue(() =>
			withStore(id, store =>
				handle.fetch(request, {
					store,
					images: imagesFor(id),
					space: id,
					defer: task => deferred.push(task),
				}),
			),
		);
		void Promise.allSettled(deferred.map(task => task()));
		return response;
	};
	const bindings: Env = {
		...env,
		ACCOUNT: {
			idFromName: (name: string) => name,
			get: (id: string) => ({ fetch: (request: Request) => accountFetch(id, request) }),
		} as unknown as Env['ACCOUNT'],
	};

	server = Bun.serve<SocketData>({
		development: true,
		idleTimeout: 120,
		port,
		async fetch(request) {
			const response = await api.fetch(request, bindings);
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
