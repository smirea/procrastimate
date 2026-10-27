import type { Server } from 'bun';
import { handle } from './api';
import { createApp } from './app';
import type { Env } from './bindings';
import { config } from './config';
import type { Store } from './db/store';
import { headMessage, liveProtocol, type Live } from './live';
import { dbRambleData, rambleRoute, upstreamOf, upstreamUrl, type ConnectUpstream } from './ramble';
import type { OpenSocket } from './ramble-gemini';
import type { Socket, StreamEvents, StreamHost } from './sockets';

type SocketData = { start: (socket: Socket) => StreamEvents; events?: StreamEvents };

/** The sync sockets on Bun: a set of open sockets, `ping` answered with `pong` like the Durable Object's auto-response. */
function bunLive(stream: (request: Request, protocol: string | null, start: SocketData['start']) => Response): Live {
	const sockets = new Set<Socket>();
	return {
		accept: request =>
			stream(request, liveProtocol(request), socket => {
				sockets.add(socket);
				console.log('LIVE open', sockets.size);
				return {
					message: data => data === 'ping' && socket.send('pong'),
					close: () => console.log('LIVE close', sockets.delete(socket)),
				};
			}),
		publish(head) {
			console.log('LIVE publish', head, sockets.size);
			for (const socket of sockets) socket.send(headMessage(head));
		},
	};
}

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

/** A WebSocket from Bun. Gemini sends its messages as binary frames, so they are decoded to text. */
export const bunSocket: OpenSocket = (url, events) =>
	new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.binaryType = 'arraybuffer';
		let opened = false;
		socket.addEventListener('open', () => {
			opened = true;
			resolve({ send: text => socket.send(text), close: () => socket.close(1000, 'Done') });
		});
		socket.addEventListener('message', ({ data }) =>
			events.message(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)),
		);
		socket.addEventListener('close', ({ code, reason }) => {
			if (!opened) reject(new Error(`The upstream refused the connection: ${code} ${reason}`));
			else events.close();
		});
	});

/**
 * The Bun dev server: the Worker's handler on Bun's HTTP server, with Ramble's socket on Bun's WebSocket server.
 * Bun upgrades through `server.upgrade` and needs the fetch handler to answer nothing, so an accepted upgrade
 * returns a marker response that `fetch` swaps for `undefined`. No idle timeout, since sync sockets stay open.
 */
export async function serveDev(port: number, env: Env, store: Store): Promise<Server<SocketData>> {
	const upgraded = new WeakSet<Response>();
	let server: Server<SocketData> | undefined;
	const upgrade = (request: Request, protocol: string | null, start: SocketData['start']) => {
		const headers = protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined;
		if (!server?.upgrade(request, { data: { start }, headers })) {
			return Response.json({ ok: false, error: 'Upgrade failed' }, { status: 400 });
		}
		const marker = new Response(null);
		upgraded.add(marker);
		return marker;
	};
	const stream: StreamHost = (request, protocol, start) => upgrade(request, protocol, start);
	const ramble = rambleRoute(dbRambleData(store.db), stream, upstreamOf(config(env), bunUpstream, bunSocket));
	const app = await createApp(env, store, ramble, bunLive(upgrade));
	server = Bun.serve<SocketData>({
		development: true,
		idleTimeout: 0,
		port,
		async fetch(request) {
			const response = await handle(request, app);
			return upgraded.has(response) ? undefined : response;
		},
		websocket: {
			open(socket) {
				socket.data.events = socket.data.start(socket);
			},
			close(socket) {
				socket.data.events?.close();
			},
			message(socket, message) {
				socket.data.events?.message(typeof message === 'string' ? message : new Uint8Array(message));
			},
		},
	});
	return server;
}
