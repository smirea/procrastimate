import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';
import { onError } from '@orpc/server';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { accountContract, internalContract } from '../../../shared/api/contract';
import type { Person } from '../../../shared/sharing';
import { nudgeSchema, repairBooleanNumbers } from '../../../shared/sync/protocol';
import { CLIENT_HEADER } from '../../../shared/auth';
import { actorOf, clientOf, readActor, SHARED_ROUTES, spaceOf, withActor } from '../actor';
import type { AccountContext, AccountRoute, Access } from '../auth';
import type { Env, Handler } from '../bindings';
import { pushSender } from '../push';
import { personOf } from './activity';
import {
	databaseImages,
	guestImageAccess,
	imageResponse,
	isImageRoute,
	memoryImages,
	OWNER_ACCESS,
	referencedImages,
	IMAGE_UPLOAD_ROUTE,
	sweepPlan,
	type ImageStore,
} from './images';
import { memoryStore } from './memory-store';
import { internalClient } from './peers';
import { deliverDue } from './push';
import { ramble, rambleRoutes, workerUpstream, type RambleConfig } from './ramble';
import { openRambleBudget } from './ramble-budget';
import { cassetteUpstream } from './ramble-cassette';
import { queuedRambleLedger, type RambleLedger, type RambleUsage } from './ramble-ledger';
import { durableSockets, noSockets, realtime, realtimeRoutes, type SocketHost } from './realtime';
import { serialQueue } from './serial';
import { config } from '../config';
import { identify, reportError, reportRpcError, span } from '../sentry';
import { tursoDatabase } from '../db/turso';
import { errorResponse } from '../errors';
import { routeKeys } from '../routes';
import { accountRouter } from './router';
import { liveGuests, rememberPerson } from './sharing';
import { accountSnapshot } from './sync';
import { sqliteStore } from './sqlite-store';
import { tracedStore, type AccountStore } from './store';
import { tursoSession, writeUserRamble, type AccountSession } from './turso';

/** The WebSocket upgrades, which the contract cannot describe. */
const socketRoutes: Record<string, AccountRoute> = { ...realtimeRoutes, ...rambleRoutes };

const INTERNAL_ROUTES = new Set(routeKeys(internalContract));
const [NUDGE_ROUTE] = routeKeys(internalContract.nudge);
const [SYNC_ROUTE] = routeKeys(accountContract.sync);

type SetAlarm = (at: number | null) => Promise<void>;

/** What a host gives the handler for one request. `defer` runs after the request leaves the serial queue. */
export type RequestHost = {
	store: AccountStore;
	images: ImageStore;
	space: string;
	defer: (task: () => Promise<void>) => void;
};

/**
 * What a host gives an image request. `open` runs `use` on the loaded account inside the space's serial queue, which
 * only a guest's request needs: the owner's skips the queue and the load.
 */
export type ImageHost = {
	images: ImageStore;
	space: string;
	open: <T>(use: (store: AccountStore) => Promise<T>) => Promise<T>;
};

export type AccountHandler = {
	fetch(request: Request, host: RequestHost): Promise<Response>;
	/** The nudge from another space, answered without the queue or the store: it only touches sockets. */
	relay(request: Request): Promise<Response>;
	images(request: Request, host: ImageHost): Promise<Response>;
};

/** A sweep reads every image row's id, so it runs at most this often per space while the object stays up. */
const SWEEP_INTERVAL = 60 * 60 * 1000;

const rpc = new OpenAPIHandler(accountRouter, { interceptors: [onError(reportRpcError)] });

/**
 * iOS builds up to 2026.1011.235500 sent some numbers as booleans, and their stored outboxes still hold those ops.
 * The repair runs before the contract validates the body.
 */
async function repairSyncBody(request: Request): Promise<Request> {
	const body: unknown = await request.json().catch(() => undefined);
	const { method, headers } = request;
	return new Request(request.url, { method, headers, body: JSON.stringify(repairBooleanNumbers(body)) });
}

export const routeKey = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;

/**
 * The object's request handler over any store, shared by the Worker, the Bun dev server, and the test binding. The
 * object is the space: it serves its owner, a guest the owner shared with, and the Worker's internal calls, which
 * act as the owner. Whenever a request moves the log, every open socket hears the new head, and every guest's
 * space is told after the request leaves the queue.
 */
export function accountHandler(
	setAlarm: SetAlarm,
	sockets: SocketHost = noSockets,
	rambleConfig: RambleConfig = { connect: null },
	peers: () => DurableObjectNamespace | undefined = () => undefined,
): AccountHandler {
	const live = realtime(sockets);
	const transcription = ramble(sockets, rambleConfig);
	const swept = new Map<string, number>();
	return {
		async fetch(request, { store, images, space, defer }) {
			const key = routeKey(request);
			const now = Date.now();
			const origin = new URL(request.url).origin;
			// Behind Vite's dev proxy the request URL names the API port, while the browser's origin is the app's.
			const linkOrigin = request.headers.get('origin') ?? origin;
			const internal = INTERNAL_ROUTES.has(key);
			const actor = internal ? personOf(store, space) : actorOf(request);
			if (!actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
			const client = clientOf(request);
			if (!client) return errorResponse('BAD_REQUEST', `Invalid ${CLIENT_HEADER} header`);
			identify(actor);
			const access = admission(store, space, actor);
			if (!access) return errorResponse('FORBIDDEN', 'Not shared with you');
			if (access.role === 'guest' && !SHARED_ROUTES.has(key)) {
				return errorResponse('FORBIDDEN', 'Only the owner can do this');
			}
			if (!internal) rememberPerson(store, actor, now);
			const context: AccountContext = {
				store,
				now,
				setAlarm,
				realtime: live,
				ramble: transcription,
				space,
				actor,
				client,
				access,
				images,
				origin: linkOrigin,
				defer,
				peer: id => {
					const namespace = peers();
					return namespace ? internalClient(namespace, id, origin) : null;
				},
			};
			const head = store.lastSeq();
			const socket = socketRoutes[key];
			const response = socket ? await socket(request, context) : await call(request, key, context);
			const next = store.lastSeq();
			// A reset empties the log, so the head can fall; that is a change too, and the wiped tasks' images go.
			if (next !== head && now - (swept.get(space) ?? 0) >= SWEEP_INTERVAL) {
				swept.set(space, now);
				const referenced = referencedImages(accountSnapshot(store));
				defer(async () => images.sweep(sweepPlan(referenced, await images.states(), now)));
			}
			if (next > head) {
				live.nudge(next);
				for (const guest of liveGuests(store)) {
					defer(async () => {
						await context.peer(guest)?.nudge({ cursor: next, space });
					});
				}
			}
			return response;
		},
		async relay(request) {
			const parsed = nudgeSchema.required({ space: true }).safeParse(await request.json().catch(() => null));
			if (!parsed.success) return errorResponse('BAD_REQUEST', 'Invalid nudge');
			live.nudge(parsed.data.cursor, parsed.data.space);
			return Response.json({ ok: true });
		},
		async images(request, { images, space, open }) {
			const actor = actorOf(request);
			if (!actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
			identify(actor);
			const now = Date.now();
			if (actor.kind === 'human' && actor.id === space) return imageResponse(request, images, OWNER_ACCESS, now);
			// Only the check needs the account; the bytes move after the queue releases, so an upload never holds it.
			const access = await open(async store => {
				const admitted = admission(store, space, actor);
				return admitted?.role === 'guest' ? guestImageAccess(accountSnapshot(store), admitted.shares) : null;
			});
			if (!access) return errorResponse('FORBIDDEN', 'Not shared with you');
			return imageResponse(request, images, access, now);
		},
	};
}

/** The owner, or a guest with the space's shares to them. Anyone else is turned away. */
function admission(store: AccountStore, space: string, actor: Person): Access | null {
	// An AI account has no space of its own; owning one would hand each token an empty writable partition.
	if (actor.id === space) return actor.kind === 'human' ? { role: 'owner' } : null;
	const shares = store.shares().filter(share => share.grantee === actor.id);
	return shares.length ? { role: 'guest', shares } : null;
}

async function call(request: Request, key: string, context: AccountContext): Promise<Response> {
	const parsed = key === SYNC_ROUTE ? await repairSyncBody(request) : request;
	const { response } = await rpc.handle(parsed, { context: { ...context, request: parsed } });
	return response ?? errorResponse('NOT_FOUND', 'Not found');
}

export const isNudge = (request: Request) => routeKey(request) === NUDGE_ROUTE;

/**
 * One space, one SQLite-backed Durable Object named by its owner's user id. Turso I/O yields, so requests for this
 * space run through `run`: load, handle, and flush finish before the next one starts. Calls to other spaces run
 * after the slot releases, and a nudge from another space skips the queue, so mutual shares never wait on each other.
 */
export class Account {
	private readonly open: () => Promise<AccountSession>;
	private readonly images: ImageStore;
	private readonly handle: AccountHandler;
	private readonly run = serialQueue();
	private readonly ledger: RambleLedger;
	private readonly space: string;

	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: Env,
	) {
		this.space = ctx.id.name ?? '';
		const { turso } = config(env);
		// The object's own SQLite holds the account only in an ephemeral run. With Turso, its
		// leftover tables are never read, so it is not migrated and its history cannot fail the account.
		if (turso) {
			this.open = () => tursoSession(turso, this.space, this.ledger);
			this.images = databaseImages(() => tursoDatabase(turso), this.space);
		} else {
			const database = drizzle(ctx.storage);
			const store = sqliteStore(database, this.space, 'strict');
			this.open = async () => ({ store, flush: async () => {} });
			this.images = databaseImages(() => database, this.space);
		}
		this.handle = accountHandler(
			at => this.setAlarm(at),
			durableSockets(ctx),
			workerRamble(env),
			() => env.ACCOUNT,
		);
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
		if (!this.space) return errorResponse('NOT_FOUND', 'No such space');
		if (isNudge(request)) return this.handle.relay(request);
		const { images, space } = this;
		if (isImageRoute(request)) {
			return this.handle.images(request, { images, space, open: use => this.run(() => this.withStore(use)) });
		}
		const deferred: Array<() => Promise<void>> = [];
		const response = await this.run(() =>
			this.withStore(store => this.handle.fetch(request, { store, images, space, defer: task => deferred.push(task) })),
		);
		this.ctx.waitUntil(Promise.all(deferred.map(task => task().catch(reportError))));
		return response;
	}

	async alarm(): Promise<void> {
		if (!this.space) return;
		await this.run(() =>
			this.withStore(async store => {
				const next = await span('deliver due pushes', 'push.deliver', () =>
					deliverDue(store, Date.now(), pushSender(this.env)),
				);
				await this.setAlarm(next);
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

	private async withStore<T>(use: (store: AccountStore) => Promise<T>): Promise<T> {
		const session = await this.open();
		try {
			return await use(tracedStore(session.store));
		} finally {
			await session.flush();
		}
	}

	/** Writes the ledger's seconds. A no-op in an ephemeral run. */
	private writeLedger(rows: RambleUsage[]): Promise<void> {
		const { turso } = config(this.env);
		if (!turso) return Promise.resolve();
		return writeUserRamble(turso, this.space, rows);
	}
}

/**
 * ElevenLabs with the key, a cassette when `wrangler dev` runs the end-to-end tests, or Ramble off. The global
 * budget is on only for the real upstream, where the seconds are billed.
 */
function workerRamble(env: Env): RambleConfig {
	const { ramble, turso } = config(env);
	if (!ramble) return { connect: null };
	if (ramble.kind === 'cassette') return { connect: cassetteUpstream() };
	return { connect: workerUpstream(ramble.apiKey), budget: turso ? openRambleBudget(turso) : null };
}

/**
 * Every account route goes to the space `?space=` names, or the actor's own, with the actor on the request and the
 * body unread. An AI account only reaches the routes in `SHARED_ROUTES`.
 */
const forward: Handler = async (request, env) => {
	if (!env.ACCOUNT) return errorResponse('SERVICE_UNAVAILABLE', 'Sync is not configured');
	const actor = await readActor(request, env);
	if (!actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
	const url = new URL(request.url);
	if (actor.kind === 'ai' && !SHARED_ROUTES.has(`${request.method} ${url.pathname}`)) {
		return errorResponse('FORBIDDEN', 'Not for AI accounts');
	}
	const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(spaceOf(url, actor)));
	return span(`Account ${request.method} ${url.pathname}`, 'durable_object.fetch', () =>
		stub.fetch(withActor(request, actor) as never),
	) as unknown as Promise<Response>;
};

/** The Worker's routes for the account, mounted by `api.ts`. The internal contract stays off this map. */
export const accountApiRoutes: Record<string, Handler> = Object.fromEntries(
	[...routeKeys(accountContract), ...Object.keys(socketRoutes), IMAGE_UPLOAD_ROUTE].map(key => [key, forward]),
);

/**
 * An `ACCOUNT` binding for tests. The first space uses `store`, which the test inspects. Another space gets a fresh
 * store, so two accounts do not share tasks. Like the Worker, each space runs one request at a time and answers a
 * nudge outside that queue.
 */
export function memoryAccount(
	store: AccountStore = memoryStore(),
	setAlarm: SetAlarm = async () => {},
	sockets: SocketHost = noSockets,
	rambleConfig: RambleConfig = { connect: null },
): DurableObjectNamespace {
	const spaces = new Map<string, { store: AccountStore; images: ImageStore; run: ReturnType<typeof serialQueue> }>();
	const namespace = {
		idFromName: (name: string) => name,
		get: (id: string) => ({
			fetch: async (request: Request) => {
				if (isNudge(request)) return handle.relay(request);
				let space = spaces.get(id);
				if (!space) {
					space = { store: spaces.size === 0 ? store : memoryStore(), images: memoryImages(), run: serialQueue() };
					spaces.set(id, space);
				}
				const { store: current, images, run } = space;
				if (isImageRoute(request)) {
					return handle.images(request, { images, space: id, open: use => run(() => use(current)) });
				}
				const deferred: Array<() => Promise<void>> = [];
				const response = await run(() =>
					handle.fetch(request, { store: current, images, space: id, defer: task => deferred.push(task) }),
				);
				void Promise.all(deferred.map(task => task().catch(reportError)));
				return response;
			},
		}),
	} as unknown as DurableObjectNamespace;
	const handle = accountHandler(setAlarm, sockets, rambleConfig, () => namespace);
	return namespace;
}
