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

type Socket = { send(message: string): void; close(code: number, reason: string): void };

/**
 * Where the sockets live: the Durable Object's hibernation API on the Worker, Bun's server in development.
 * `accept` answers an upgrade the route already authenticated, and `sockets` lists the open ones, or one device's.
 */
export type SocketHost = {
	accept(request: Request, deviceId: string): Response;
	sockets(deviceId?: string): Iterable<Socket>;
};

export type Realtime = {
	accept: SocketHost['accept'];
	/** Tells every open socket the log's new head. */
	nudge(cursor: number): void;
	/** Closes a removed device's sockets. */
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
		nudge(cursor) {
			const message = JSON.stringify({ cursor } satisfies Nudge);
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
};

/** The `Sec-WebSocket-Protocol` a successful upgrade answers with. Browsers drop a socket without it. */
export const acceptedProtocol = { 'Sec-WebSocket-Protocol': SYNC_SOCKET_PROTOCOL };

/** Globals of the Workers runtime, absent from Bun. */
type WorkersRuntime = {
	WebSocketPair: new () => Record<0 | 1, WebSocket>;
	WebSocketRequestResponsePair: new (request: string, response: string) => unknown;
};

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
