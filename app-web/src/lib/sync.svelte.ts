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
import { api, isUnauthorized } from './api.ts';
import { session } from './session.svelte.ts';
import { store } from './store.svelte.ts';

/**
 * Syncs this install with the signed-in user's account: on launch, on focus, when the network returns, one second
 * after a commit, every minute while visible, and whenever the realtime socket reports a cursor past this device's.
 * A failed sync keeps the outbox and retries on the next trigger. Nothing about it is shown.
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

	/** Registers the triggers, opens the realtime socket, and syncs once. Returns the cleanup. */
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
			if (nudge.success) void this.#hear(nudge.data.cursor);
		};
		socket.onclose = () => this.#retry();
	}

	/** Syncs when the account is past this device's cursor, after the sync already running, which may cover it. */
	async #hear(cursor: number) {
		await this.#running;
		const own = store.syncRequest()?.cursor;
		if (own !== undefined && cursor > own) void this.syncNow();
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

	/** Drops a failed socket and opens another after a delay that doubles up to a minute. */
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

	/** Syncs now, or once more right after the sync already running. */
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
		} while (this.#again && store.ready);
	}

	/** One round trip. True when the response was a full page, so another round is due. */
	async #once(): Promise<boolean> {
		if (session.state !== 'in' || !store.ready || !store.deviceId()) return false;
		store.noteTimeZone(zone());
		const request = store.syncRequest();
		if (!request) return false;
		let response: unknown;
		try {
			response = await api.sync(request, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
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
			return false;
		}
		store.takeResponse(parsed.data);
		return 'changes' in parsed.data && parsed.data.changes.length >= SYNC_PAGE_SIZE;
	}
}

export const sync = new Sync();
