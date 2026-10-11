import { INSTALL_GATE, type RegisteredDevice } from 'shared/auth.ts';
import {
	nudgeSchema,
	SOCKET_PING,
	SOCKET_PONG,
	SOCKET_TOKEN_PREFIX,
	SYNC_PAGE_SIZE,
	SYNC_SOCKET_PATH,
	SYNC_SOCKET_PROTOCOL,
	syncResponseSchema,
} from 'shared/sync/protocol.ts';
import { store } from './store.svelte.ts';

/**
 * Syncs this install with the server: on launch, on focus, when the network returns, one second after a commit,
 * every minute while visible, and whenever the realtime socket reports a cursor past this device's. A failed sync
 * keeps the outbox and retries on the next trigger. Nothing about it is shown.
 */

/** The bearer token sits under its own key, outside the snapshot document. */
const TOKEN_KEY = 'procrastimate-device';
const COMMIT_DELAY = 1000;
const INTERVAL = 60_000;
/** A keepalive that also finds a dead socket: one that answers nothing between two pings is dropped. */
const PING_INTERVAL = 30_000;
const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 60_000;

const readToken = () => localStorage.getItem(TOKEN_KEY);

/** This device's sync token, which other API calls that act for the device carry too. */
export const deviceToken = readToken;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A name stored with the device, such as `Chrome on macOS`. It is never shown. */
function deviceName(): string {
	const ua = navigator.userAgent;
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /Firefox\//.test(ua)
			? 'Firefox'
			: /Chrome\//.test(ua)
				? 'Chrome'
				: /Safari\//.test(ua)
					? 'Safari'
					: 'Browser';
	const os = /iPhone/.test(ua)
		? 'iPhone'
		: /iPad/.test(ua)
			? 'iPad'
			: /Android/.test(ua)
				? 'Android'
				: /Mac OS X/.test(ua)
					? 'macOS'
					: /Windows/.test(ua)
						? 'Windows'
						: /Linux/.test(ua)
							? 'Linux'
							: '';
	return os ? `${browser} on ${os}` : browser;
}

class Sync {
	/** True once this install has a token. Push waits on it. */
	signedIn = $state(false);

	#running: Promise<void> | null = null;
	#again = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#socket: WebSocket | null = null;
	#keepalive: ReturnType<typeof setInterval> | undefined;
	#reconnect: ReturnType<typeof setTimeout> | undefined;
	#failures = 0;
	/** Stops a rejected token from registering and syncing forever in one loop. */
	#replaced = false;

	/** Registers the triggers, opens the realtime socket, and syncs once. Returns the cleanup. */
	start() {
		this.signedIn = readToken() !== null;
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
	 * account's new cursor after every change, and the socket only ever triggers a sync.
	 */
	#connect() {
		const token = readToken();
		if (this.#socket || !token || !store.ready || document.visibilityState !== 'visible') return;
		clearTimeout(this.#reconnect);
		const url = new URL(SYNC_SOCKET_PATH, location.href);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(url, [SYNC_SOCKET_PROTOCOL, `${SOCKET_TOKEN_PREFIX}${token}`]);
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

	/** One round trip. True when the response was a full page, or the token was just replaced, so another round is due. */
	async #once(): Promise<boolean> {
		if (!store.ready) return false;
		if (!readToken() && !(await this.#register())) return false;
		store.noteTimeZone(zone());
		const token = readToken();
		const request = store.syncRequest();
		if (!token || !request) return false;
		let response: Response;
		try {
			response = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify(request),
			});
		} catch {
			return false;
		}
		if (response.status === 401) {
			if (this.#replaced) return false;
			this.#replaced = true;
			localStorage.removeItem(TOKEN_KEY);
			this.signedIn = false;
			this.#disconnect();
			return this.#register();
		}
		if (!response.ok) return false;
		const parsed = syncResponseSchema.safeParse(await response.json().catch(() => undefined));
		if (!parsed.success) return false;
		this.#replaced = false;
		store.takeResponse(parsed.data);
		return 'changes' in parsed.data && parsed.data.changes.length >= SYNC_PAGE_SIZE;
	}

	/** Mints a new token after a rejected one, then syncs again. Callers never hear about it. */
	async reregister() {
		localStorage.removeItem(TOKEN_KEY);
		this.signedIn = false;
		this.#disconnect();
		this.#replaced = false;
		if (await this.#register()) void this.syncNow();
	}

	/** Presents this install's own token. The gate only checks that the caller is this app. */
	async #register(): Promise<boolean> {
		const deviceId = store.deviceId() ?? crypto.randomUUID();
		const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
		let response: Response;
		try {
			response = await fetch('/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ gate: INSTALL_GATE, deviceId, token, name: deviceName() }),
			});
		} catch {
			return false;
		}
		if (!response.ok) return false;
		const body = (await response.json().catch(() => null)) as RegisteredDevice | null;
		if (!body?.deviceId) return false;
		localStorage.setItem(TOKEN_KEY, token);
		store.adoptDevice(body.deviceId);
		this.signedIn = true;
		this.#connect();
		return true;
	}
}

export const sync = new Sync();
