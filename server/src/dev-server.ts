import type { Server, ServerWebSocket } from 'bun';
import { SOCKET_PING, SOCKET_PONG } from '../../shared/sync/protocol';
import { memoryAccount } from './account/account';
import { memoryStore } from './account/memory-store';
import { acceptedProtocol, type SocketHost } from './account/realtime';
import api from './api';

type SocketData = { deviceId: string };

/**
 * The Bun dev server: the Worker's handler over one in-memory account, with the nudge sockets on Bun's WebSocket
 * server. Bun upgrades through `server.upgrade` and needs the fetch handler to answer nothing, so an accepted
 * upgrade returns a marker response that `fetch` swaps for `undefined`.
 */
export function serveDev({ port, setupCode }: { port: number; setupCode: string | undefined }) {
	const open = new Set<ServerWebSocket<SocketData>>();
	const upgraded = new WeakSet<Response>();
	let server: Server<SocketData> | undefined;
	const sockets: SocketHost = {
		accept(request, deviceId) {
			if (!server?.upgrade(request, { data: { deviceId }, headers: acceptedProtocol })) {
				return Response.json({ ok: false, error: 'Upgrade failed' }, { status: 400 });
			}
			const marker = new Response(null);
			upgraded.add(marker);
			return marker;
		},
		sockets: deviceId => [...open].filter(socket => !deviceId || socket.data.deviceId === deviceId),
	};
	const bindings = { ACCOUNT: memoryAccount(setupCode, memoryStore(), undefined, sockets) };

	server = Bun.serve<SocketData>({
		development: true,
		idleTimeout: 120,
		port,
		async fetch(request) {
			const response = await api.fetch(request, bindings);
			return upgraded.has(response) ? undefined : response;
		},
		websocket: {
			open: socket => void open.add(socket),
			close: socket => void open.delete(socket),
			message: (socket, message) => void (message === SOCKET_PING && socket.send(SOCKET_PONG)),
		},
	});
	return server;
}
