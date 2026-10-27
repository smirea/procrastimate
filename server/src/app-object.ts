import type { DurableObjectState } from '@cloudflare/workers-types';
import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { durableDriver } from 'sync-engine/cloudflare';
import { handle } from './api';
import { readActor } from './actor';
import { createApp, type App } from './app';
import type { Env } from './bindings';
import { BACKUP_CRON } from './crons';
import { backupDatabase } from './db/backup';
import type { Db } from './db/sqlite';
import { openStore } from './db/store';
import { sweepImages } from './images';
import { headMessage, liveProtocol, type Live } from './live';
import { deliverDue, pushSender } from './push';
import { dbRambleData } from './ramble';

/** Paths only the Worker reaches: it forwards nothing but `/api/*` from the internet. */
export const INTERNAL = {
	actor: '/internal/actor',
	cron: '/internal/cron',
	rambleZone: '/internal/ramble/zone',
	rambleKeyterms: '/internal/ramble/keyterms',
	rambleStored: '/internal/ramble/stored',
	rambleAdd: '/internal/ramble/add',
} as const;

/**
 * The one object that holds the database: every user's synced rows, the server's tables, and Better Auth's, in its
 * SQLite storage, with the whole API on top. It runs one request at a time, so the engine's hooks and the routes'
 * reads and writes need no locks. Sync sockets hibernate, and `ping` is answered without waking the object.
 */
export class AppObject extends DurableObject<Env> {
	private readonly app: Promise<App>;
	private readonly db: Db;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx as never, env);
		const storage = ctx.storage;
		this.db = drizzle(storage as never) as unknown as Db;
		const store = openStore(this.db, durableDriver(storage));
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
		const live: Live = {
			accept: request => {
				const { 0: client, 1: server } = new WebSocketPair();
				ctx.acceptWebSocket(server as never);
				const protocol = liveProtocol(request);
				return new Response(null, {
					status: 101,
					webSocket: client,
					headers: protocol ? { 'Sec-WebSocket-Protocol': protocol } : {},
				} as ResponseInit);
			},
			publish: head => {
				for (const socket of ctx.getWebSockets()) {
					try {
						socket.send(headMessage(head));
					} catch {
						// A socket mid-close throws on send, and it has no one left to nudge.
					}
				}
			},
		};
		this.app = createApp(env, store, null, live);
	}

	override async fetch(request: Request): Promise<Response> {
		const app = await this.app;
		const url = new URL(request.url);
		if (!url.pathname.startsWith('/internal/')) return handle(request, app);
		const ramble = dbRambleData(this.db);
		const user = url.searchParams.get('user') ?? '';
		switch (url.pathname) {
			case INTERNAL.actor:
				return Response.json(await readActor(request, app));
			case INTERNAL.cron:
				return Response.json(
					await this.cron(app, url.searchParams.get('cron') ?? '', Number(url.searchParams.get('at'))),
				);
			case INTERNAL.rambleZone:
				return Response.json(await ramble.zone(user));
			case INTERNAL.rambleKeyterms:
				return Response.json(await ramble.keyterms(user));
			case INTERNAL.rambleStored:
				return Response.json(await ramble.usage(user).stored(url.searchParams.get('day') ?? ''));
			case INTERNAL.rambleAdd:
				await ramble.usage(user).add(url.searchParams.get('day') ?? '', Number(url.searchParams.get('seconds')));
				return Response.json(null);
		}
		return Response.json({ error: 'Not found' }, { status: 404 });
	}

	/** Every minute the due pushes go out; at 09:00 UTC the database is dumped to R2 and orphaned image bytes swept. */
	private async cron(app: App, cron: string, at: number): Promise<string> {
		if (cron === BACKUP_CRON) {
			if (!this.env.BACKUPS) throw new Error('The BACKUPS R2 binding is missing');
			const key = await backupDatabase(app.db, this.env.BACKUPS, new Date(at));
			sweepImages(app.db, at);
			return `Backed up the database to ${key}`;
		}
		const sent = await deliverDue(app.db, at, pushSender(this.env));
		return sent ? `Delivered ${sent} push notifications` : '';
	}

	webSocketMessage(): void {}

	webSocketClose(socket: WebSocket, code: number): void {
		try {
			socket.close(code, 'closing');
		} catch {
			// Already closed.
		}
	}
}
