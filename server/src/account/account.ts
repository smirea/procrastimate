import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';
import { authRoutes, type AccountRoute } from '../auth';
import type { Env, Handler } from '../bindings';
import { pushSender } from '../push';
import { memoryStore } from './memory-store';
import { deliverDue, pushRoutes } from './push';
import { sqliteStore } from './sqlite-store';
import type { AccountStore } from './store';
import { syncRoutes } from './sync';

/** Every route the `Account` object answers. The Worker forwards each of them to the one account. */
const accountRoutes: Record<string, AccountRoute> = { ...authRoutes, ...syncRoutes, ...pushRoutes };

type SetAlarm = (at: number | null) => Promise<void>;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/**
 * The object's request handler over any store, shared by the Worker and the Bun dev server. The dev server has no
 * alarms, so its `setAlarm` does nothing.
 */
export function accountHandler(store: AccountStore, setupCode: string | undefined, setAlarm: SetAlarm) {
	return (request: Request): Promise<Response> => {
		const route = accountRoutes[`${request.method} ${new URL(request.url).pathname}`];
		if (!route) return Promise.resolve(fail(404, 'Not found'));
		return route(request, { store, setupCode: setupCode || undefined, now: Date.now(), setAlarm });
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
		this.handle = accountHandler(this.store, env.SYNC_SETUP_CODE, at => this.setAlarm(at));
	}

	fetch(request: Request): Promise<Response> {
		return this.handle(request);
	}

	/** Delivers due Web Push notifications, then re-arms for the next. */
	async alarm(): Promise<void> {
		await this.setAlarm(await deliverDue(this.store, Date.now(), pushSender(this.env)));
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
): DurableObjectNamespace {
	const handle = accountHandler(store, setupCode, setAlarm);
	const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: handle }) };
	return namespace as unknown as DurableObjectNamespace;
}
