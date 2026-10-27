import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from './bindings';
import { config } from './config';
import { errorResponse } from './errors';
import { rambleRoute, upstreamOf, workerSocket, workerUpstream, type RambleData, type RambleRoute } from './ramble';
import { INTERNAL } from './app-object';
import { appFetch } from './app-stub';
import { workerStream } from './sockets';

/** The user's actor, set by the Worker after it authenticated the upgrade. The object trusts only this header. */
export const RAMBLE_ACTOR_HEADER = 'x-procrastimate-ramble-actor';

/**
 * One user's Ramble sessions, in a Durable Object named by the user id. It hosts only the transcription socket: the
 * object's CPU budget resets per message, and it holds the one count of the user's day that the daily cap reads. The
 * database is the `App` object's, so the session's reads and its usage go there.
 */
export class Ramble {
	private route: RambleRoute | null = null;

	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: Env,
	) {}

	async fetch(request: Request): Promise<Response> {
		const actor = request.headers.get(RAMBLE_ACTOR_HEADER);
		if (!this.ctx.id.name || !actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
		this.route ??= rambleRoute(
			appRambleData(this.env),
			workerStream(),
			upstreamOf(config(this.env), workerUpstream, workerSocket),
		);
		return this.route(request, JSON.parse(actor));
	}
}

const answer = async <T>(response: Promise<Response>): Promise<T> => {
	const settled = await response;
	if (!settled.ok) throw new Error(`App answered ${settled.status}: ${await settled.text()}`);
	return (await settled.json()) as T;
};

function appRambleData(env: Env): RambleData {
	return {
		zone: user => answer(appFetch(env, INTERNAL.rambleZone, { user })),
		keyterms: user => answer(appFetch(env, INTERNAL.rambleKeyterms, { user })),
		usage: user => ({
			stored: day => answer(appFetch(env, INTERNAL.rambleStored, { user, day })),
			add: async (day, seconds) => void (await answer(appFetch(env, INTERNAL.rambleAdd, { user, day, seconds }))),
		}),
	};
}
