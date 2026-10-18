import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import { pushSubscriptionSchema, type PushSubscriptionInfo } from 'shared/push.ts';
import { api, isUnauthorized } from './api.ts';
import { reportError } from './sentry.ts';
import { session } from './session.svelte.ts';
import { store } from './store.svelte.ts';
import { sheets } from './ui.svelte.ts';

export type PushState =
	| { kind: 'checking' }
	| { kind: 'unsupported' }
	/** The server has no push key, as with the local Bun dev server. */
	| { kind: 'unavailable' }
	/** Permission not asked yet, or granted without a subscription. */
	| { kind: 'off' }
	| { kind: 'enabling' }
	| { kind: 'denied' }
	| { kind: 'on'; subscription: PushSubscriptionInfo }
	| { kind: 'error'; message: string };

/** The one settings line. `needs-permission` is the only one that does anything when tapped. */
export type NotificationLine = 'on' | 'off' | 'needs-permission';

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

class Push {
	state = $state<PushState>({ kind: 'checking' });

	#key: Uint8Array<ArrayBuffer> | null = null;
	#asked = false;
	/** The subscription the server has for this device's token, or null until it confirms one. */
	#registered: string | null = null;

	/** `On` when subscribed, `Notifications need permission` when blocked, otherwise `Off`. */
	get line(): NotificationLine {
		if (this.state.kind === 'on') return 'on';
		if (this.state.kind === 'denied') return 'needs-permission';
		return 'off';
	}

	start() {
		void this.detect();
		const listeners: [EventTarget, string, (event: Event) => void][] = [
			[window, 'online', () => this.#retry()],
			[document, 'visibilitychange', () => document.visibilityState === 'visible' && this.#retry()],
		];
		if ('serviceWorker' in navigator) {
			listeners.push([navigator.serviceWorker, 'message', event => openTask((event as MessageEvent).data)]);
		}
		for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
		return () => {
			for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
		};
	}

	async detect() {
		const next = await this.#detect().catch(
			(error: unknown) => ({ kind: 'error', message: messageOf(error) }) as const,
		);
		// A prompt that resolved while detection was in flight already recorded a newer outcome.
		if (this.state.kind === 'enabling' || this.state.kind === 'on' || this.state.kind === 'denied') return;
		this.state = next;
	}

	async #detect(): Promise<PushState> {
		if (!pushSupported()) return { kind: 'unsupported' };
		const key = await fetchKey();
		if (!key) return { kind: 'unavailable' };
		this.#key = key;
		if (session.state !== 'in') return { kind: 'off' };
		if (Notification.permission === 'denied') return { kind: 'denied' };
		if (Notification.permission === 'default') {
			this.#askOnFirstGesture(key);
			return { kind: 'off' };
		}
		const registration = await navigator.serviceWorker.getRegistration();
		const subscription = await registration?.pushManager.getSubscription();
		const rekeying = localStorage.getItem(REKEY_KEY) !== null;
		if (!registration || (!subscription && !rekeying)) {
			await this.#subscribe(Promise.resolve('granted' as NotificationPermission), key);
			return this.state;
		}
		if (Notification.permission !== 'granted') {
			localStorage.removeItem(REKEY_KEY);
			await subscription?.unsubscribe();
			return { kind: 'off' };
		}
		const current =
			subscription && sameKey(subscription.options.applicationServerKey, key)
				? subscription
				: await rekey(registration, subscription, key);
		const info = pushSubscriptionSchema.parse(current.toJSON());
		await this.#register(info);
		return { kind: 'on', subscription: info };
	}

	/**
	 * Asks on first load. A browser that will not prompt without a gesture stays quiet until the first click or
	 * keypress, which asks with no copy of its own.
	 */
	#askOnFirstGesture(key: Uint8Array<ArrayBuffer>) {
		if (this.#asked) return;
		this.#asked = true;
		void Notification.requestPermission().then(permission => {
			if (permission === 'granted') {
				void this.#subscribe(Promise.resolve(permission), key);
				return;
			}
			if (permission === 'denied') {
				this.state = { kind: 'denied' };
				return;
			}
			const once = () => {
				window.removeEventListener('pointerdown', once, true);
				window.removeEventListener('keydown', once, true);
				void this.#subscribe(Notification.requestPermission(), key);
			};
			window.addEventListener('pointerdown', once, true);
			window.addEventListener('keydown', once, true);
		});
	}

	/** The browser may only offer its own settings. */
	request() {
		const key = this.#key;
		if (!key || this.state.kind === 'on' || this.state.kind === 'enabling') return;
		this.state = { kind: 'enabling' };
		void this.#subscribe(Notification.requestPermission(), key);
	}

	async #subscribe(permission: Promise<NotificationPermission>, key: Uint8Array<ArrayBuffer>) {
		try {
			const granted = await permission;
			if (granted !== 'granted') {
				this.state = { kind: granted === 'denied' ? 'denied' : 'off' };
				return;
			}
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: key,
			});
			const info = pushSubscriptionSchema.parse(subscription.toJSON());
			await this.#register(info);
			this.state = { kind: 'on', subscription: info };
		} catch (error) {
			reportError(error);
			this.state = { kind: 'error', message: messageOf(error) };
		}
	}

	async #register(subscription: PushSubscriptionInfo) {
		if (this.#registered === subscription.endpoint) return;
		if (session.state !== 'in') return;
		try {
			await api.push.subscribe({ subscription });
			this.#registered = subscription.endpoint;
		} catch (error) {
			if (isUnauthorized(error)) session.clear();
		}
	}

	#retry() {
		if (this.state.kind === 'unavailable' || this.state.kind === 'error' || this.state.kind === 'off')
			void this.detect();
		else if (this.state.kind === 'on') void this.#register(this.state.subscription);
	}
}

export const push = new Push();

/** Opens the task a notification was for: from `?task=` when the click launched the app, or from the service worker when it was already open. */
export function openTaskFromUrl() {
	const id = page.url.searchParams.get('task');
	if (id === null) return;
	openTask({ type: 'open-task', taskId: id });
	const url = new URL(page.url.href);
	url.searchParams.delete('task');
	replaceState(url, page.state);
}

function openTask(message: unknown) {
	if (typeof message !== 'object' || message === null) return;
	const { type, taskId } = message as { type?: unknown; taskId?: unknown };
	if (type === 'open-task' && typeof taskId === 'string' && store.task(taskId)) sheets.openTask(taskId);
}

async function fetchKey(): Promise<Uint8Array<ArrayBuffer> | null> {
	const publicKey = await api.push
		.key()
		.then(body => body.publicKey)
		.catch(() => null);
	if (!publicKey) return null;
	try {
		const base64 = publicKey.replaceAll('-', '+').replaceAll('_', '/');
		return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0));
	} catch {
		return null;
	}
}

/** Set while a rekey has dropped the old subscription but not made the new one, so a retry or relaunch finishes it. */
const REKEY_KEY = 'procrastimate-push-rekey';

/**
 * Moves a subscription made for a rotated server key to the current one. Permission is already granted, so this
 * needs no prompt. Browsers refuse a second key on a live subscription, so the old one goes first. A failed
 * subscribe throws, which leaves push in the `error` state that retries when the device comes back online or visible.
 */
async function rekey(
	registration: ServiceWorkerRegistration,
	stale: PushSubscription | null | undefined,
	key: Uint8Array<ArrayBuffer>,
): Promise<PushSubscription> {
	localStorage.setItem(REKEY_KEY, '1');
	await stale?.unsubscribe();
	const fresh = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
	localStorage.removeItem(REKEY_KEY);
	return fresh;
}

function sameKey(current: ArrayBuffer | null, key: Uint8Array) {
	if (!current) return false;
	const bytes = new Uint8Array(current);
	return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
