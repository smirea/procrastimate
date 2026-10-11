import type { DeviceCredentials, DeviceInfo, DeviceList, PairingCode } from 'shared/auth.ts';
import { SYNC_PAGE_SIZE, syncResponseSchema } from 'shared/sync/protocol.ts';
import { store } from './store.svelte.ts';

/**
 * Syncs a paired device with the server: on launch, on focus, when the network returns, one second after a
 * commit, and every minute while visible. A failed sync keeps the outbox and retries on the next trigger. An
 * unpaired device never talks to the server.
 */

export type SyncStatus =
	| { kind: 'off'; notice?: string }
	| { kind: 'syncing' }
	| { kind: 'synced' }
	| { kind: 'offline' }
	| { kind: 'error'; message: string };

/** The bearer token sits under its own key, outside the snapshot document. */
const TOKEN_KEY = 'procrastimate-device';
const COMMIT_DELAY = 1000;
const INTERVAL = 60_000;

const readToken = () => localStorage.getItem(TOKEN_KEY);
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A name for the device list, such as `Chrome on macOS`. */
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

class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

async function errorOf(response: Response, fallback: string): Promise<ApiError> {
	const body = (await response.json().catch(() => null)) as { error?: string } | null;
	return new ApiError(response.status, body?.error ?? fallback);
}

class Sync {
	status = $state<SyncStatus>({ kind: 'off' });

	#running: Promise<void> | null = null;
	#again = false;
	#timer: ReturnType<typeof setTimeout> | undefined;

	/** Registers the triggers and syncs once. Returns the cleanup. */
	start() {
		if (store.paired && readToken()) this.status = { kind: 'synced' };
		else if (store.paired) store.unpair();
		const onVisible = () => document.visibilityState === 'visible' && void this.syncNow();
		const onTrigger = () => void this.syncNow();
		const stopCommits = store.onCommit(() => this.#schedule());
		window.addEventListener('focus', onTrigger);
		window.addEventListener('online', onTrigger);
		document.addEventListener('visibilitychange', onVisible);
		const interval = setInterval(() => document.visibilityState === 'visible' && void this.syncNow(), INTERVAL);
		void this.syncNow();
		return () => {
			stopCommits();
			window.removeEventListener('focus', onTrigger);
			window.removeEventListener('online', onTrigger);
			document.removeEventListener('visibilitychange', onVisible);
			clearInterval(interval);
			clearTimeout(this.#timer);
		};
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
		} while (this.#again && store.paired);
	}

	/** One round trip. True when the response was a full page, so more changes are waiting. */
	async #once(): Promise<boolean> {
		const token = readToken();
		if (!token || !store.paired) return false;
		store.noteTimeZone(zone());
		const request = store.syncRequest()!;
		this.status = { kind: 'syncing' };
		let response: Response;
		try {
			response = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify(request),
			});
		} catch {
			this.status = { kind: 'offline' };
			return false;
		}
		if (response.status === 401) {
			this.forget('This device was removed from sync.');
			return false;
		}
		if (!response.ok) {
			this.status = response.status >= 500 ? { kind: 'offline' } : { kind: 'error', message: 'Sync failed.' };
			return false;
		}
		const parsed = syncResponseSchema.safeParse(await response.json().catch(() => undefined));
		if (!parsed.success) {
			this.status = { kind: 'error', message: 'The server sent an unreadable answer.' };
			return false;
		}
		store.takeResponse(parsed.data);
		this.status = { kind: 'synced' };
		return 'changes' in parsed.data && parsed.data.changes.length >= SYNC_PAGE_SIZE;
	}

	async #call<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
		const token = readToken();
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (token) headers.Authorization = `Bearer ${token}`;
		let response: Response;
		try {
			response = await fetch(path, { ...init, headers });
		} catch {
			throw new ApiError(0, 'Can’t reach the server.');
		}
		if (response.status === 401 && token && path !== '/api/auth/setup' && path !== '/api/auth/redeem') {
			this.forget('This device was removed from sync.');
		}
		if (!response.ok) throw await errorOf(response, fallback);
		return (await response.json()) as T;
	}

	#adopt({ deviceId, token }: DeviceCredentials) {
		localStorage.setItem(TOKEN_KEY, token);
		store.pair(deviceId, zone());
		void this.syncNow();
	}

	/** The first device: proves it knows the server's setup code. */
	async setUp(code: string) {
		const body = JSON.stringify({ code: code.trim(), name: deviceName() });
		const credentials = await this.#call<DeviceCredentials>(
			'/api/auth/setup',
			{ method: 'POST', body },
			'Wrong setup code.',
		).catch(error => {
			if (error instanceof ApiError && error.status === 503)
				throw new ApiError(503, 'Sync isn’t set up on the server.');
			if (error instanceof ApiError && error.status === 401) throw new ApiError(401, 'That setup code is wrong.');
			throw error;
		});
		this.#adopt(credentials);
	}

	/** A new device: enters the code a paired one shows. */
	async redeem(code: string) {
		const body = JSON.stringify({ code, name: deviceName() });
		const credentials = await this.#call<DeviceCredentials>(
			'/api/auth/redeem',
			{ method: 'POST', body },
			'Invalid code.',
		).catch(error => {
			if (error instanceof ApiError && error.status === 401) throw new ApiError(401, 'That code is wrong or expired.');
			throw error;
		});
		this.#adopt(credentials);
	}

	pairingCode() {
		return this.#call<PairingCode>('/api/auth/pair', { method: 'POST' }, 'Couldn’t make a code.');
	}

	async devices(): Promise<DeviceInfo[]> {
		return (await this.#call<DeviceList>('/api/auth/devices', { method: 'GET' }, 'Couldn’t load devices.')).devices;
	}

	/** Revokes a device's token at once. Removing this device turns sync off here. */
	async remove(device: DeviceInfo) {
		await this.#call(
			'/api/auth/devices',
			{ method: 'DELETE', body: JSON.stringify({ id: device.id }) },
			'Couldn’t remove it.',
		);
		if (device.current) this.forget();
	}

	/** Turns sync off on this device and keeps its data. */
	forget(notice?: string) {
		localStorage.removeItem(TOKEN_KEY);
		store.unpair();
		this.status = { kind: 'off', notice };
	}
}

export const sync = new Sync();
