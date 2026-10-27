import { LIVE_PROTOCOL } from 'sync-engine/core';

/**
 * The sync sockets: a device holds one open at `/api/live` and pulls when it hears a head above its cursor. Every
 * user's rows share one space, so every socket hears every head; a reader whose view did not change pulls an empty
 * delta. The Durable Object hibernates its sockets and answers `ping` with `pong` without waking; the Bun dev server
 * holds them in memory.
 */
export type Live = {
	/** Answers the upgrade of an authenticated request. */
	accept(request: Request): Response;
	publish(head: number): void;
};

/** The engine's subprotocol, echoed only when offered: a client that offered none fails the handshake on an echo. */
export const liveProtocol = (request: Request): string | null =>
	request.headers
		.get('sec-websocket-protocol')
		?.split(',')
		.some(protocol => protocol.trim() === LIVE_PROTOCOL)
		? LIVE_PROTOCOL
		: null;

export const headMessage = (head: number) => JSON.stringify({ head });
