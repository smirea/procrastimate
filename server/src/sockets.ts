/**
 * WebSocket hosting for Ramble's audio stream: a `WebSocketPair` on the Worker, Bun's server in development. The
 * session code sees only `Socket` and `StreamEvents`.
 */

export type Socket = { send(message: string): void; close(code: number, reason: string): void };

export type StreamEvents = { message(data: string | Uint8Array): void; close(): void };

export type StreamHost = (request: Request, protocol: string, start: (socket: Socket) => StreamEvents) => Response;

/** A Workers runtime socket, which must be accepted before it carries messages. */
export type WorkerSocket = WebSocket & { accept(): void };

type WorkersRuntime = { WebSocketPair: new () => Record<0 | 1, WorkerSocket> };

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

/** The Worker's host: a pair whose server half is accepted at once, outside hibernation. */
export function workerStream(): StreamHost {
	const runtime = globalThis as unknown as WorkersRuntime;
	return (_request, protocol, start) => {
		const { 0: client, 1: server } = new runtime.WebSocketPair();
		server.accept();
		listenWorkerSocket(server, start(server));
		const headers = { 'Sec-WebSocket-Protocol': protocol };
		return new Response(null, { status: 101, webSocket: client, headers } as ResponseInit);
	};
}
