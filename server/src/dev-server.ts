import type { Server } from 'bun';
import { handle } from './api';
import { createApp } from './app';
import type { Env } from './bindings';
import { config } from './config';
import type { Db } from './db/postgres';
import { ramble, rambleRoute, upstreamUrl, type ConnectUpstream, type RambleConfig } from './ramble';
import { pgRambleBudget, RAMBLE_GLOBAL_DAILY_SECONDS } from './ramble-budget';
import { cassetteUpstream } from './ramble-cassette';
import type { Socket, StreamEvents, StreamHost } from './sockets';

type SocketData = { start: (socket: Socket) => StreamEvents; events?: StreamEvents };

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

function bunRambleConfig(env: Env, db: Db): RambleConfig {
	const settings = config(env).ramble;
	switch (settings?.kind) {
		case 'elevenlabs':
			return { connect: bunUpstream(settings.apiKey), budget: pgRambleBudget(db, RAMBLE_GLOBAL_DAILY_SECONDS) };
		case 'cassette':
			return { connect: cassetteUpstream() };
		default:
			return { connect: null };
	}
}

/**
 * The Bun dev server: the Worker's handler on Bun's HTTP server, with Ramble's socket on Bun's WebSocket server.
 * Bun upgrades through `server.upgrade` and needs the fetch handler to answer nothing, so an accepted upgrade
 * returns a marker response that `fetch` swaps for `undefined`. No idle timeout, since PowerSync streams stay open.
 */
export async function serveDev(port: number, env: Env, db: Db): Promise<Server<SocketData>> {
	const upgraded = new WeakSet<Response>();
	let server: Server<SocketData> | undefined;
	const stream: StreamHost = (request, protocol, start) => {
		if (!server?.upgrade(request, { data: { start }, headers: { 'Sec-WebSocket-Protocol': protocol } })) {
			return Response.json({ ok: false, error: 'Upgrade failed' }, { status: 400 });
		}
		const marker = new Response(null);
		upgraded.add(marker);
		return marker;
	};
	const app = await createApp(env, db, rambleRoute(db, ramble(stream, bunRambleConfig(env, db))));
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
