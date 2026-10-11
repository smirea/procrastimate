import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';
import { authRoutes, type AccountRoute } from '../auth';
import type { Env, Handler } from '../bindings';
import { pushSender } from '../push';
import { memoryStore } from './memory-store';
import { deliverDue, pushRoutes } from './push';
import { ramble, rambleRoutes, workerUpstream, type RambleConfig } from './ramble';
import { cassetteUpstream } from './ramble-cassette';
import { durableSockets, noSockets, realtime, realtimeRoutes, type SocketHost } from './realtime';
import { sqliteStore } from './sqlite-store';
import type { AccountStore } from './store';
import { syncRoutes } from './sync';
import { tursoSession, type AccountSession } from './turso';

/** Every route the `Account` object answers. The Worker forwards each of them to the one account. */
const accountRoutes: Record<string, AccountRoute> = {
	...authRoutes,
	...syncRoutes,
	...pushRoutes,
	...realtimeRoutes,
	...rambleRoutes,
};

type SetAlarm = (at: number | null) => Promise<void>;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/**
 * The object's request handler over any store, shared by the Worker and the Bun dev server. The dev server has no
 * alarms, so its `setAlarm` does nothing. Whenever a request moves the log, every open socket hears the new head.
 */
export function accountHandler(
	setAlarm: SetAlarm,
	sockets: SocketHost = noSockets,
	rambleConfig: RambleConfig = { connect: null },
) {
	const live = realtime(sockets);
	const transcription = ramble(sockets, rambleConfig);
	return async (request: Request, store: AccountStore): Promise<Response> => {
		const route = accountRoutes[`${request.method} ${new URL(request.url).pathname}`];
		if (!route) return fail(404, 'Not found');
		const head = store.lastSeq();
		const response = await route(request, {
			store,
			now: Date.now(),
			setAlarm,
			realtime: live,
			ramble: transcription,
		});
		const next = store.lastSeq();
		if (next > head) live.nudge(next);
		return response;
	};
}

/** Turso when both secrets are set, otherwise the store the host already has (SQLite on the Worker, memory in dev). */
export async function openAccount(env: Env, fallback: AccountStore): Promise<AccountSession> {
	if (env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN) return tursoSession(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
	return { store: fallback, flush: async () => {} };
}

/** The single account, one SQLite-backed Durable Object that runs one request at a time. */
export class Account {
	private readonly sqlite: AccountStore;
	private readonly handle: (request: Request, store: AccountStore) => Promise<Response>;

	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: Env,
	) {
		this.sqlite = sqliteStore(ctx.storage.sql, run => ctx.storage.transactionSync(run));
		this.handle = accountHandler(at => this.setAlarm(at), durableSockets(ctx), workerRamble(env));
	}

	async fetch(request: Request): Promise<Response> {
		const session = await openAccount(this.env, this.sqlite);
		try {
			return await this.handle(request, session.store);
		} finally {
			await session.flush();
		}
	}

	/** Delivers due Web Push notifications, then re-arms for the next. */
	async alarm(): Promise<void> {
		const session = await openAccount(this.env, this.sqlite);
		try {
			await this.setAlarm(await deliverDue(session.store, Date.now(), pushSender(this.env)));
		} finally {
			await session.flush();
		}
	}

	/** Clients only send the keepalive, which the runtime answers without waking the object. */
	webSocketMessage(): void {}

	webSocketClose(socket: WebSocket, code: number, reason: string): void {
		try {
			socket.close(code, reason);
		} catch {}
	}

	private async setAlarm(at: number | null) {
		await (at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at));
	}
}

/** ElevenLabs with the key, a cassette when `wrangler dev` runs the end-to-end tests, or Ramble off. */
function workerRamble(env: Env): RambleConfig {
	if (env.RAMBLE_UPSTREAM === 'cassette') return { connect: cassetteUpstream() };
	return { connect: env.ELEVENLABS_API_KEY ? workerUpstream(env.ELEVENLABS_API_KEY) : null };
}

/** There is one account, so every request goes to the object with this name. */
const ACCOUNT_NAME = 'account';

const forward: Handler = (request, env) => {
	if (!env.ACCOUNT) return fail(503, 'Sync is not configured');
	const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(ACCOUNT_NAME));
	return stub.fetch(request as never) as unknown as Promise<Response>;
};

/** The Worker's routes for the account, mounted by `api.ts`. */
export const accountApiRoutes: Record<string, Handler> = Object.fromEntries(
	Object.keys(accountRoutes).map(key => [key, forward]),
);

/** An `ACCOUNT` binding for the Bun dev server: one in-memory account, lost on restart. */
export function memoryAccount(
	store: AccountStore = memoryStore(),
	setAlarm: SetAlarm = async () => {},
	sockets: SocketHost = noSockets,
	rambleConfig: RambleConfig = { connect: null },
): DurableObjectNamespace {
	const handle = accountHandler(setAlarm, sockets, rambleConfig);
	const namespace = {
		idFromName: (name: string) => name,
		get: () => ({ fetch: (request: Request) => handle(request, store) }),
	};
	return namespace as unknown as DurableObjectNamespace;
}
