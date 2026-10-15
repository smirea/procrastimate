import type { DurableObjectState } from '@cloudflare/workers-types';
import {
	SOCKET_PING,
	SOCKET_PONG,
	SOCKET_REVOKED,
	SYNC_SOCKET_PATH,
	SYNC_SOCKET_PROTOCOL,
	type Nudge,
} from '../../../shared/sync/protocol';
import { authenticate, type AccountRoute } from '../auth';

/**
 * The realtime nudge. A paired client keeps a WebSocket open to the account, and after every request that moved
 * the log the account sends the new cursor to each socket. The socket carries no data: a client that hears a
 * cursor past its own syncs over `POST /api/sync`, so polling stays the fallback and a missed nudge costs nothing.
 */

export type Socket = { send(message: string): void; close(code: number, reason: string): void };

export type StreamEvents = { message(data: string | Uint8Array): void; close(): void };

/**
 * Where the sockets live: the Durable Object's hibernation API on the Worker, Bun's server in development.
 * `accept` answers an upgrade the route already authenticated, and `sockets` lists the open ones, or one device's.
 * `stream` answers an upgrade with a socket outside hibernation and outside `sockets`, driven by the handlers
 * `start` returns, for Ramble's audio stream, which keeps the object awake anyway.
 */
export type SocketHost = {
	accept(request: Request, deviceId: string): Response;
	sockets(deviceId?: string): Iterable<Socket>;
	stream(request: Request, protocol: string, start: (socket: Socket) => StreamEvents): Response;
};

export type Realtime = {
	accept: SocketHost['accept'];
	/** `space` names another space that moved, by its owner's id; without it the nudge is for this one. */
	nudge(cursor: number, space?: string): void;
	revoke(deviceId: string): void;
};

/** A socket can already be closing, which makes `send` and `close` throw. Losing a nudge only delays a sync. */
function attempt(run: () => void) {
	try {
		run();
	} catch {}
}

export function realtime(host: SocketHost): Realtime {
	return {
		accept: (request, deviceId) => host.accept(request, deviceId),
		nudge(cursor, space) {
			const message = JSON.stringify((space ? { cursor, space } : { cursor }) satisfies Nudge);
			for (const socket of host.sockets()) attempt(() => socket.send(message));
		},
		revoke(deviceId) {
			for (const socket of host.sockets(deviceId)) attempt(() => socket.close(SOCKET_REVOKED, 'Device removed'));
		},
	};
}

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/** For accounts without sockets, as in tests that only call the HTTP routes. */
export const noSockets: SocketHost = {
	accept: () => fail(501, 'Realtime is not available'),
	sockets: () => [],
	stream: () => fail(501, 'Realtime is not available'),
};

/** The `Sec-WebSocket-Protocol` a successful upgrade answers with. Browsers drop a socket without it. */
export const acceptedProtocol = { 'Sec-WebSocket-Protocol': SYNC_SOCKET_PROTOCOL };

/** A Workers runtime socket, which must be accepted before it carries messages unless it hibernates. */
export type WorkerSocket = WebSocket & { accept(): void };

/** Globals of the Workers runtime, absent from Bun. */
type WorkersRuntime = {
	WebSocketPair: new () => Record<0 | 1, WorkerSocket>;
	WebSocketRequestResponsePair: new (request: string, response: string) => unknown;
};

/**
 * Feeds an accepted Workers socket's messages and its close or error to `events`, binary as bytes. Since the
 * standard binary type compatibility flag, binary messages arrive as `Blob` unless asked for as `ArrayBuffer`.
 */
export function listenWorkerSocket(socket: WorkerSocket, events: StreamEvents) {
	socket.binaryType = 'arraybuffer';
	socket.addEventListener('message', ({ data }) =>
		events.message(typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer)),
	);
	socket.addEventListener('close', () => events.close());
	socket.addEventListener('error', () => events.close());
}

/**
 * Sockets on the Durable Object's hibernation API: the object can be evicted while they stay open, so idle sockets
 * cost no duration. Each socket is tagged with its device id, and the runtime answers the keepalive ping itself
 * without waking the object.
 */
export function durableSockets(ctx: DurableObjectState): SocketHost {
	const runtime = globalThis as unknown as WorkersRuntime;
	ctx.setWebSocketAutoResponse(new runtime.WebSocketRequestResponsePair(SOCKET_PING, SOCKET_PONG) as never);
	return {
		accept(_request, deviceId) {
			const { 0: client, 1: server } = new runtime.WebSocketPair();
			ctx.acceptWebSocket(server as never, [deviceId]);
			return new Response(null, { status: 101, webSocket: client, headers: acceptedProtocol } as ResponseInit);
		},
		sockets: deviceId => ctx.getWebSockets(deviceId),
		stream(_request, protocol, start) {
			const { 0: client, 1: server } = new runtime.WebSocketPair();
			server.accept();
			listenWorkerSocket(server, start(server));
			const headers = { 'Sec-WebSocket-Protocol': protocol };
			return new Response(null, { status: 101, webSocket: client, headers } as ResponseInit);
		},
	};
}

export const realtimeRoutes: Record<string, AccountRoute> = {
	[`GET ${SYNC_SOCKET_PATH}`]: async (request, context) => {
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail(426, 'Expected a WebSocket');
		const deviceId = await authenticate(request, context);
		if (!deviceId) return fail(401, 'Not signed in');
		return context.realtime.accept(request, deviceId);
	},
};
