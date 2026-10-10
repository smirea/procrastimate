import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';
import { authRoutes, type AccountRoute } from '../auth';
import type { Env, Handler } from '../bindings';
import { memoryStore } from './memory-store';
import { sqliteStore } from './sqlite-store';
import type { AccountStore } from './store';

/** Every route the `Account` object answers. The Worker forwards each of them to the one account. */
const accountRoutes: Record<string, AccountRoute> = { ...authRoutes };

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/** The object's request handler over any store, shared by the Worker and the Bun dev server. */
export function accountHandler(store: AccountStore, setupCode: string | undefined) {
	return (request: Request): Promise<Response> => {
		const route = accountRoutes[`${request.method} ${new URL(request.url).pathname}`];
		if (!route) return Promise.resolve(fail(404, 'Not found'));
		return route(request, { store, setupCode: setupCode || undefined, now: Date.now() });
	};
}

/** The single account, one SQLite-backed Durable Object that runs one request at a time. */
export class Account {
	private readonly handle: (request: Request) => Promise<Response>;

	constructor(ctx: DurableObjectState, env: Env) {
		const store = sqliteStore(ctx.storage.sql, run => ctx.storage.transactionSync(run));
		this.handle = accountHandler(store, env.SYNC_SETUP_CODE);
	}

	fetch(request: Request): Promise<Response> {
		return this.handle(request);
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
export function memoryAccount(setupCode: string | undefined, store = memoryStore()): DurableObjectNamespace {
	const handle = accountHandler(store, setupCode);
	const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: handle }) };
	return namespace as unknown as DurableObjectNamespace;
}
