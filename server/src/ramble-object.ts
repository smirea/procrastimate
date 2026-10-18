import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from './bindings';
import { config, type Config } from './config';
import { connect, type Connection } from './db/postgres';
import { errorResponse } from './errors';
import { ramble, rambleRoute, workerUpstream, type RambleConfig, type RambleRoute } from './ramble';
import { pgRambleBudget, RAMBLE_GLOBAL_DAILY_SECONDS } from './ramble-budget';
import { cassetteUpstream } from './ramble-cassette';
import { workerStream } from './sockets';

/** The Worker's Ramble upstream: ElevenLabs with the shared budget, the cassette for `wrangler dev`, or off. */
export function workerRambleConfig(settings: Config, connection: () => Connection): RambleConfig {
	switch (settings.ramble?.kind) {
		case 'elevenlabs':
			return {
				connect: workerUpstream(settings.ramble.apiKey),
				budget: pgRambleBudget(connection().db, RAMBLE_GLOBAL_DAILY_SECONDS),
			};
		case 'cassette':
			return { connect: cassetteUpstream() };
		default:
			return { connect: null };
	}
}

/** The user's actor, set by the Worker after it authenticated the upgrade. The object trusts only this header. */
export const RAMBLE_ACTOR_HEADER = 'x-procrastimate-ramble-actor';

/**
 * One user's Ramble sessions, in a Durable Object named by the user id. It hosts only the transcription socket: the
 * object's CPU budget resets per message, and its `live` set counts the user's open sessions against the daily cap.
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
			ramble(
				workerStream(),
				workerRambleConfig(config(this.env), () => this.open()),
			),
		);
		return this.route(request, JSON.parse(actor));
	}
}
