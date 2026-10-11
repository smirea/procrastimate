import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';
import { authRoutes, type AccountRoute } from '../auth';
import type { Env, Handler } from '../bindings';
import { pushSender } from '../push';
import { memoryStore } from './memory-store';
import { deliverDue, pushRoutes } from './push';
import { durableSockets, noSockets, realtime, realtimeRoutes, type SocketHost } from './realtime';
import { sqliteStore } from './sqlite-store';
import type { AccountStore } from './store';
import { syncRoutes } from './sync';

/** Every route the `Account` object answers. The Worker forwards each of them to the one account. */
const accountRoutes: Record<string, AccountRoute> = { ...authRoutes, ...syncRoutes, ...pushRoutes, ...realtimeRoutes };

type SetAlarm = (at: number | null) => Promise<void>;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/**
 * The object's request handler over any store, shared by the Worker and the Bun dev server. The dev server has no
 * alarms, so its `setAlarm` does nothing. Whenever a request moves the log, every open socket hears the new head.
 */
export function accountHandler(
	store: AccountStore,
	setupCode: string | undefined,
	setAlarm: SetAlarm,
	sockets: SocketHost = noSockets,
) {
	const live = realtime(sockets);
	return async (request: Request): Promise<Response> => {
		const route = accountRoutes[`${request.method} ${new URL(request.url).pathname}`];
		if (!route) return fail(404, 'Not found');
		const head = store.lastSeq();
		const response = await route(request, {
			store,
			setupCode: setupCode || undefined,
			now: Date.now(),
			setAlarm,
			realtime: live,
		});
		const next = store.lastSeq();
		if (next > head) live.nudge(next);
		return response;
	};
}

/** The single account, one SQLite-backed Durable Object that runs one request at a time. */
export class Account {
	private readonly store: AccountStore;
	private readonly handle: (request: Request) => Promise<Response>;

	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: Env,
	) {
		this.store = sqliteStore(ctx.storage.sql, run => ctx.storage.transactionSync(run));
		this.handle = accountHandler(this.store, env.SYNC_SETUP_CODE, at => this.setAlarm(at), durableSockets(ctx));
	}

	fetch(request: Request): Promise<Response> {
		return this.handle(request);
	}

	/** Delivers due Web Push notifications, then re-arms for the next. */
	async alarm(): Promise<void> {
		await this.setAlarm(await deliverDue(this.store, Date.now(), pushSender(this.env)));
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
	setupCode: string | undefined,
	store = memoryStore(),
	setAlarm: SetAlarm = async () => {},
	sockets: SocketHost = noSockets,
): DurableObjectNamespace {
	const handle = accountHandler(store, setupCode, setAlarm, sockets);
	const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: handle }) };
	return namespace as unknown as DurableObjectNamespace;
}
