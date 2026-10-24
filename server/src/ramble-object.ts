import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from './bindings';
import { config } from './config';
import { connect, type Connection } from './db/postgres';
import { errorResponse } from './errors';
import { rambleRoute, upstreamOf, workerSocket, workerUpstream, type RambleRoute } from './ramble';
import { workerStream } from './sockets';

/** The user's actor, set by the Worker after it authenticated the upgrade. The object trusts only this header. */
export const RAMBLE_ACTOR_HEADER = 'x-procrastimate-ramble-actor';

/**
 * One user's Ramble sessions, in a Durable Object named by the user id. It hosts only the transcription socket: the
 * object's CPU budget resets per message, and it holds the one count of the user's day that the daily cap reads.
 */
export class Ramble {
	private connection: Connection | null = null;
	private route: RambleRoute | null = null;

	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: Env,
	) {}

	private open(): Connection {
		this.connection ??= connect(config(this.env).database);
		return this.connection;
	}

	async fetch(request: Request): Promise<Response> {
		const actor = request.headers.get(RAMBLE_ACTOR_HEADER);
		if (!this.ctx.id.name || !actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
		this.route ??= rambleRoute(
			this.open().db,
			workerStream(),
			upstreamOf(config(this.env), workerUpstream, workerSocket),
		);
		return this.route(request, JSON.parse(actor));
	}
}
