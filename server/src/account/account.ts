import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';
import { onError, ORPCError, ValidationError } from '@orpc/server';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { USER_HEADER } from '../../../shared/auth';
import { accountContract } from '../../../shared/api/contract';
import { repairBooleanNumbers } from '../../../shared/sync/protocol';
import type { AccountContext, AccountRoute } from '../auth';
import { getAuth, readSession } from '../better-auth';
import type { Env, Handler } from '../bindings';
import { withUser } from '../request-user';
import { pushSender } from '../push';
import { memoryStore } from './memory-store';
import { deliverDue } from './push';
import { ramble, rambleRoutes, workerUpstream, type RambleConfig } from './ramble';
import { openRambleBudget } from './ramble-budget';
import { cassetteUpstream } from './ramble-cassette';
import { queuedRambleLedger, type RambleLedger, type RambleUsage } from './ramble-ledger';
import { durableSockets, noSockets, realtime, realtimeRoutes, type SocketHost } from './realtime';
import { serialQueue } from './serial';
import { tursoTarget } from '../db/turso';
import { errorResponse } from '../errors';
import { routeKeys } from '../routes';
import { accountRouter } from './router';
import { sqliteStore } from './sqlite-store';
import type { AccountStore } from './store';
import { tursoSession, writeUserRamble, type AccountSession } from './turso';

/** The WebSocket upgrades, which the contract cannot describe. */
const socketRoutes: Record<string, AccountRoute> = { ...realtimeRoutes, ...rambleRoutes };

type SetAlarm = (at: number | null) => Promise<void>;

const rpc = new OpenAPIHandler(accountRouter, {
	interceptors: [
		onError(error => {
			if (!(error instanceof ORPCError) || error.code !== 'BAD_REQUEST') return;
			const issues = error.cause instanceof ValidationError ? error.cause.issues : error.message;
			console.warn('account: invalid request', JSON.stringify(issues).slice(0, 2000));
		}),
	],
});

/**
 * iOS builds up to 2026.1011.235500 sent some numbers as booleans, and their stored outboxes still hold those ops.
 * The repair runs before the contract validates the body.
 */
async function repairSyncBody(request: Request): Promise<Request> {
	const body: unknown = await request.json().catch(() => undefined);
	const { method, headers } = request;
	return new Request(request.url, { method, headers, body: JSON.stringify(repairBooleanNumbers(body)) });
}

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
		const key = `${request.method} ${new URL(request.url).pathname}`;
		const context = { store, now: Date.now(), setAlarm, realtime: live, ramble: transcription };
		const head = store.lastSeq();
		const socket = socketRoutes[key];
		const response = socket ? await socket(request, context) : await call(request, key, context);
		const next = store.lastSeq();
		if (next > head) live.nudge(next);
		return response;
	};
}

const [SYNC_ROUTE] = routeKeys(accountContract.sync);

async function call(request: Request, key: string, context: AccountContext): Promise<Response> {
	const parsed = key === SYNC_ROUTE ? await repairSyncBody(request) : request;
	const { response } = await rpc.handle(parsed, { context: { ...context, request: parsed } });
	return response ?? errorResponse('NOT_FOUND', 'Not found');
}

/**
 * Turso when both secrets are set, otherwise the store the host already has (SQLite on the Worker, memory in dev).
 * An end-to-end shard stays on that local store, so the run cannot write the dev database.
 */
export async function openAccount(
	env: Env,
	fallback: AccountStore,
	userId: string,
	ledger?: RambleLedger,
): Promise<AccountSession> {
	const turso = tursoTarget(env);
	if (turso) return tursoSession(turso, userId, ledger);
	return { store: fallback, flush: async () => {} };
}

/**
 * The user id the Worker put on the request after checking the session. A missing header is rejected. So is a
 * header that names someone other than the object, which is created with `idFromName(userId)`.
 */
export function accountUserId(request: Request, name: string | undefined): string | null {
	const userId = request.headers.get(USER_HEADER)?.trim() ?? '';
	if (!userId) return null;
	if (name && name !== userId) return null;
	return userId;
}

/**
 * The single account, one SQLite-backed Durable Object. Turso I/O yields, so requests for this user run through
 * `run`: load, handle, and flush finish before the next one starts.
 */
export class Account {
	private readonly sqlite: AccountStore;
	private readonly handle: (request: Request, store: AccountStore) => Promise<Response>;
	private readonly run = serialQueue();
	private readonly ledger: RambleLedger;
	private userId = '';

	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: Env,
	) {
		this.sqlite = sqliteStore(drizzle(ctx.storage), ctx.id.name ?? '');
		this.handle = accountHandler(at => this.setAlarm(at), durableSockets(ctx), workerRamble(env));
		this.ledger = queuedRambleLedger(
			task => {
				const pending = this.run(task);
				this.ctx.waitUntil(pending);
				return pending;
			},
			rows => this.writeLedger(rows),
		);
	}

	async fetch(request: Request): Promise<Response> {
		const userId = accountUserId(request, this.ctx.id.name);
		if (!userId) return errorResponse('UNAUTHORIZED', 'Not signed in');
		this.userId = userId;
		return this.run(() => this.withStore(userId, store => this.handle(request, store)));
	}

	/** Delivers due Web Push notifications, then re-arms for the next. */
	async alarm(): Promise<void> {
		const userId = this.ctx.id.name ?? '';
		if (!userId) return;
		this.userId = userId;
		await this.run(() =>
			this.withStore(userId, async store => {
				await this.setAlarm(await deliverDue(store, Date.now(), pushSender(this.env)));
			}),
		);
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

	private async withStore<T>(userId: string, use: (store: AccountStore) => Promise<T>): Promise<T> {
		const session = await openAccount(this.env, this.sqlite, userId, this.ledger);
		try {
			return await use(session.store);
		} finally {
			await session.flush();
		}
	}

	/** Writes the ledger's seconds. A no-op until Turso is configured and a request has named the user. */
	private writeLedger(rows: RambleUsage[]): Promise<void> {
		const turso = tursoTarget(this.env);
		if (!turso || !this.userId) return Promise.resolve();
		return writeUserRamble(turso, this.userId, rows);
	}
}

/**
 * ElevenLabs with the key, a cassette when `wrangler dev` runs the end-to-end tests, or Ramble off. The global
 * budget is on only for the real upstream, where the seconds are billed.
 */
function workerRamble(env: Env): RambleConfig {
	if (env.RAMBLE_UPSTREAM === 'cassette') return { connect: cassetteUpstream() };
	if (!env.ELEVENLABS_API_KEY) return { connect: null };
	const turso = tursoTarget(env);
	const budget = turso ? openRambleBudget(turso) : null;
	return { connect: workerUpstream(env.ELEVENLABS_API_KEY), budget };
}

const forward: Handler = async (request, env) => {
	if (!env.ACCOUNT) return errorResponse('SERVICE_UNAVAILABLE', 'Sync is not configured');
	if (!(await getAuth(env))) return errorResponse('SERVICE_UNAVAILABLE', 'Sign-in is not configured');
	const user = await readSession(request, env);
	if (!user) return errorResponse('UNAUTHORIZED', 'Not signed in');
	const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id));
	return stub.fetch(withUser(request, user.id) as never) as unknown as Promise<Response>;
};

/** The Worker's routes for the account, mounted by `api.ts`. The internal contract stays off this map. */
export const accountApiRoutes: Record<string, Handler> = Object.fromEntries(
	[...routeKeys(accountContract), ...Object.keys(socketRoutes)].map(key => [key, forward]),
);

/**
 * An `ACCOUNT` binding for tests. The first user id uses `store`, which the test inspects. Another user gets a
 * fresh store, so two accounts do not share tasks.
 */
export function memoryAccount(
	store: AccountStore = memoryStore(),
	setAlarm: SetAlarm = async () => {},
	sockets: SocketHost = noSockets,
	rambleConfig: RambleConfig = { connect: null },
): DurableObjectNamespace {
	const handle = accountHandler(setAlarm, sockets, rambleConfig);
	const stores = new Map<string, AccountStore>();
	const namespace = {
		idFromName: (name: string) => name,
		get: (id: string) => ({
			fetch: (request: Request) => {
				let current = stores.get(id);
				if (!current) {
					current = stores.size === 0 ? store : memoryStore();
					stores.set(id, current);
				}
				return handle(request, current);
			},
		}),
	};
	return namespace as unknown as DurableObjectNamespace;
}
