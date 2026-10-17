import {
	DEVICE_PROTOCOL_PREFIX,
	nudgeSchema,
	SOCKET_PING,
	SOCKET_PONG,
	SYNC_PAGE_SIZE,
	SYNC_SOCKET_PATH,
	SYNC_SOCKET_PROTOCOL,
	syncResponseSchema,
} from 'shared/sync/protocol.ts';
import { ORPCError } from '@orpc/client';
import { api, isUnauthorized } from './api.ts';
import { reportWarning } from './sentry.ts';
import { images } from './images/images.svelte.ts';
import { session } from './session.svelte.ts';
import { store } from './store.svelte.ts';
import { toasts } from './ui.svelte.ts';

/**
 * Syncs this install with the signed-in user's account, then each space shared with them, one request per space:
 * on launch, on focus, when the network returns, one second after a commit, every minute while visible, and whenever
 * the realtime socket reports a cursor past this device's or a change in a shared space.
 * A failed sync keeps the outbox and retries on the next trigger. Nothing about it is shown, except a toast for an
 * edit the server rejected, which leaves the outbox and goes back to the server's value.
 */

const COMMIT_DELAY = 1000;
const INTERVAL = 60_000;
/**
 * A request that never answers, as across a deploy or a dead connection, would hold `#running` forever, and every
 * later trigger would wait on it, so the tab silently stopped syncing. The signal also bounds reading the body.
 */
const REQUEST_TIMEOUT = 20_000;
/** A keepalive that also finds a dead socket: one that answers nothing between two pings is dropped. */
const PING_INTERVAL = 30_000;
/** How often the list of spaces shared with this user is checked, besides launch and a nudge from an unknown one. */
const SPACES_INTERVAL = 5 * 60_000;
const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 60_000;

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

class Sync {
	#running: Promise<void> | null = null;
	#again = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#socket: WebSocket | null = null;
	#keepalive: ReturnType<typeof setInterval> | undefined;
	#reconnect: ReturnType<typeof setTimeout> | undefined;
	#failures = 0;
	#spacesAt = 0;

	start() {
		const onVisible = () => {
			if (document.visibilityState !== 'visible') return this.#disconnect();
			void this.syncNow();
			this.#connect();
		};
		const onTrigger = () => {
			void this.syncNow();
			this.#connect();
		};
		const stopCommits = store.onCommit(() => this.#schedule());
		window.addEventListener('focus', onTrigger);
		window.addEventListener('online', onTrigger);
		document.addEventListener('visibilitychange', onVisible);
		const interval = setInterval(() => document.visibilityState === 'visible' && void this.syncNow(), INTERVAL);
		void this.syncNow();
		this.#connect();
		return () => {
			stopCommits();
			window.removeEventListener('focus', onTrigger);
			window.removeEventListener('online', onTrigger);
			document.removeEventListener('visibilitychange', onVisible);
			clearInterval(interval);
			clearTimeout(this.#timer);
			this.#disconnect();
		};
	}

	/**
	 * Opens the realtime socket while visible, unless one is already open or opening. The server sends the
	 * account's new cursor after every change, and the socket only ever triggers a sync. The session cookie
	 * goes with the upgrade; the subprotocol carries the device id because a browser cannot set headers.
	 */
	#connect() {
		const id = store.deviceId();
		if (this.#socket || session.state !== 'in' || !id || !store.ready || document.visibilityState !== 'visible') return;
		clearTimeout(this.#reconnect);
		const url = new URL(SYNC_SOCKET_PATH, location.href);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(url, [SYNC_SOCKET_PROTOCOL, `${DEVICE_PROTOCOL_PREFIX}${id}`]);
		this.#socket = socket;
		let heard = true;
		socket.onopen = () => {
			void this.syncNow();
			this.#failures = 0;
			this.#keepalive = setInterval(() => {
				if (!heard) return this.#retry();
				heard = false;
				socket.send(SOCKET_PING);
			}, PING_INTERVAL);
		};
		socket.onmessage = ({ data }) => {
			heard = true;
			if (data === SOCKET_PONG) return;
			let message: unknown;
			try {
				message = JSON.parse(String(data));
			} catch {
				return;
			}
			const nudge = nudgeSchema.safeParse(message);
			if (!nudge.success) return;
			if (nudge.data.space === undefined) void this.#hear(nudge.data.cursor);
			else void this.#hearSpace(nudge.data.space);
		};
		socket.onclose = () => this.#retry();
	}

	/** Syncs when the account is past this device's cursor, after the sync already running, which may cover it. */
	async #hear(cursor: number) {
		await this.#running;
		const own = store.syncRequest()?.cursor;
		if (own !== undefined && cursor > own) void this.syncNow();
	}

	/**
	 * A shared space's nudge carries this user's own head, not the space's, so it always syncs. One from a space not
	 * listed here yet refreshes the list first.
	 */
	async #hearSpace(space: string) {
		await this.#running;
		if (!store.spaces[space]) this.#spacesAt = 0;
		void this.syncNow();
	}

	#disconnect() {
		const socket = this.#socket;
		this.#socket = null;
		clearInterval(this.#keepalive);
		clearTimeout(this.#reconnect);
		if (!socket) return;
		socket.onopen = socket.onmessage = socket.onclose = null;
		socket.close();
	}

	#retry() {
		this.#disconnect();
		const delay = Math.min(RECONNECT_MIN * 2 ** this.#failures, RECONNECT_MAX);
		this.#failures++;
		this.#reconnect = setTimeout(() => this.#connect(), delay);
	}

	#schedule() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.syncNow(), COMMIT_DELAY);
	}

	syncNow(): Promise<void> {
		if (this.#running) {
			this.#again = true;
			return this.#running;
		}
		this.#running = this.#loop().finally(() => (this.#running = null));
		return this.#running;
	}

	async #loop() {
		do {
			this.#again = false;
			if (await this.#once()) this.#again = true;
			else await this.#shared();
		} while (this.#again && store.ready);
	}

	/** After the user's own sync: refreshes which spaces are shared when due, then syncs each one. */
	async #shared() {
		if (session.state !== 'in' || !store.ready) return;
		if (Date.now() - this.#spacesAt >= SPACES_INTERVAL) {
			const options = { signal: AbortSignal.timeout(REQUEST_TIMEOUT) };
			const [list, me, shares] = await Promise.all([
				api.spaces.list(undefined, options).catch(() => null),
				api.me(undefined, options).catch(() => null),
				api.shares.list(undefined, options).catch(() => null),
			]);
			if (list) {
				this.#spacesAt = Date.now();
				store.setSpaces(list.spaces);
			}
			// The people this user shares with, so their edits to the user's own tasks are named offline.
			store.rememberPeople([
				...(me ? [me] : []),
				...(shares?.shares.flatMap(s => (s.grantee ? [s.grantee] : [])) ?? []),
			]);
		}
		for (const owner of Object.keys(store.spaces)) await this.#space(owner);
	}

	async #space(owner: string) {
		// Captured before the uploads, so every edit it carries was recorded after its image was queued.
		const request = store.spaceRequest(owner);
		if (!request) return;
		let response: unknown;
		try {
			await images.upload(owner);
			response = await api.sync(
				{ query: { space: owner }, body: request },
				{ signal: AbortSignal.timeout(REQUEST_TIMEOUT) },
			);
		} catch (error) {
			if (error instanceof ORPCError && error.code === 'FORBIDDEN') store.dropSpace(owner);
			return;
		}
		const parsed = syncResponseSchema.safeParse(response);
		if (!parsed.success) return;
		const notice = store.takeSpaceResponse(owner, parsed.data);
		if (notice) toasts.show(notice);
	}

	/** One round trip. True when the response was a full page or seeded the outbox, so another round is due. */
	async #once(): Promise<boolean> {
		if (session.state !== 'in' || !store.ready || !store.deviceId()) return false;
		store.noteTimeZone(zone());
		// Captured before the uploads, so every edit it carries was recorded after its image was queued, and the edits
		// that list a new image go out only after its bytes.
		const request = store.syncRequest();
		if (!request) return false;
		let response: unknown;
		try {
			await images.upload(null);
			response = await api.sync({ query: {}, body: request }, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
		} catch (error) {
			if (isUnauthorized(error)) {
				session.clear();
				this.#disconnect();
			}
			return false;
		}
		// The server is another deploy than this tab, so the response is checked before it reaches the store.
		const parsed = syncResponseSchema.safeParse(response);
		if (!parsed.success) {
			console.warn('sync: unreadable response', parsed.error.issues.slice(0, 5));
			reportWarning('sync: unreadable response', { issues: parsed.error.issues.slice(0, 20) });
			return false;
		}
		const { seeded, notice } = store.takeResponse(parsed.data);
		if (notice) toasts.show(notice);
		return seeded || ('changes' in parsed.data && parsed.data.changes.length >= SYNC_PAGE_SIZE);
	}
}

export const sync = new Sync();
