import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import { pushSubscriptionSchema, type PushSubscriptionInfo } from 'shared/push.ts';
import { notificationTimes, type Due, type Reminder } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { deviceToken, sync } from './sync.svelte.ts';
import { sheets, toasts } from './ui.svelte.ts';

/** Where this device stands with Web Push. Each kind is one view in the Notifications sheet. */
export type PushState =
	| { kind: 'checking' }
	| { kind: 'unsupported' }
	/** An iPhone or iPad Safari tab: Push exists only after Add to Home Screen. */
	| { kind: 'install' }
	/** The server has no push key, as with the local Bun dev server. */
	| { kind: 'unavailable' }
	/** The server computes notifications from synced tasks, so push needs this device paired first. */
	| { kind: 'unpaired' }
	/** Permission not asked yet, or granted without a subscription. */
	| { kind: 'off' }
	| { kind: 'enabling' }
	| { kind: 'denied' }
	| { kind: 'on'; subscription: PushSubscriptionInfo }
	| { kind: 'error'; message: string };

/** Chromium's install prompt, which lib.dom does not type. */
type InstallPromptEvent = Event & { prompt: () => Promise<unknown> };

const isIos = () =>
	/iPhone|iPad|iPod/.test(navigator.userAgent) ||
	(navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
const isStandalone = () =>
	matchMedia('(display-mode: standalone)').matches ||
	('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

class Push {
	state = $state<PushState>({ kind: 'checking' });
	installPrompt = $state.raw<InstallPromptEvent | null>(null);

	#key: Uint8Array<ArrayBuffer> | null = null;
	#nudged = false;
	#paired: boolean | null = null;
	/** The subscription the server has for this device's token, or null until it confirms one. */
	#registered: string | null = null;

	/** Detects the state and listens for what can change it. Returns the cleanup. */
	start() {
		void this.detect();
		const listeners: [EventTarget, string, (event: Event) => void][] = [
			[
				window,
				'beforeinstallprompt',
				event => {
					event.preventDefault();
					this.installPrompt = event as InstallPromptEvent;
				},
			],
			[window, 'appinstalled', () => (this.installPrompt = null)],
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
		if (this.state.kind !== 'enabling') this.state = next;
	}

	async #detect(): Promise<PushState> {
		if (isIos() && !isStandalone()) return { kind: 'install' };
		if (!pushSupported()) return { kind: 'unsupported' };
		const key = await fetchKey();
		if (!key) return { kind: 'unavailable' };
		this.#key = key;
		if (!store.paired) return { kind: 'unpaired' };
		if (Notification.permission === 'denied') return { kind: 'denied' };
		const registration = await navigator.serviceWorker.getRegistration();
		const subscription = await registration?.pushManager.getSubscription();
		if (!registration || !subscription) return { kind: 'off' };
		if (Notification.permission !== 'granted') {
			await subscription.unsubscribe();
			return { kind: 'off' };
		}
		const current = sameKey(subscription.options.applicationServerKey, key)
			? subscription
			: await resubscribe(registration, subscription, key);
		if (!current) return { kind: 'off' };
		const info = pushSubscriptionSchema.parse(current.toJSON());
		await this.#register(info);
		return { kind: 'on', subscription: info };
	}

	/** Detects again when this device pairs or unpairs, since push needs a paired device. */
	follow(paired: boolean) {
		const changed = this.#paired !== null && this.#paired !== paired;
		this.#paired = paired;
		if (!changed) return;
		this.#registered = null;
		void this.detect();
	}

	/** Call straight from a click handler: iOS only shows the permission prompt during a user gesture. */
	enable() {
		const key = this.#key;
		if (this.state.kind !== 'off' || !key) return;
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
			this.state = { kind: 'error', message: messageOf(error) };
		}
	}

	async disable() {
		if (this.state.kind !== 'on') return;
		this.#registered = null;
		this.state = { kind: 'off' };
		await this.#call('DELETE');
		await this.#unsubscribe();
	}

	/** Sends a push now. `false` means it could not be sent. */
	async sendTest(): Promise<boolean> {
		if (this.state.kind !== 'on') return false;
		const body = JSON.stringify({ subscription: this.state.subscription });
		const response = await fetch('/api/push/test', { method: 'POST', headers: JSON_HEADERS, body }).catch(() => null);
		if (response?.status === 410) await this.#expire();
		return response?.ok ?? false;
	}

	async promptInstall() {
		const event = this.installPrompt;
		this.installPrompt = null;
		await event?.prompt();
	}

	/** Offers the Notifications sheet once per session, when a save first gives a task a time to notify. */
	nudge(due: Due | null, reminders: readonly Reminder[]) {
		const offerable = this.state.kind === 'off' || this.state.kind === 'install' || this.state.kind === 'unpaired';
		if (this.#nudged || !offerable) return;
		if (!notificationTimes(due, reminders).length) return;
		this.#nudged = true;
		toasts.show('Get notified when it’s due?', { label: 'Turn on', run: () => sheets.openNotifications() }, 8000);
	}

	/** Registers the subscription under this device's token. The server then pushes whatever the synced tasks call for. */
	async #register(subscription: PushSubscriptionInfo) {
		if (this.#registered === subscription.endpoint) return;
		const response = await this.#call('PUT', { subscription });
		if (response?.ok) this.#registered = subscription.endpoint;
	}

	/** Calls the subscription route as this device. A `401` means the device was removed, so sync turns off. */
	async #call(method: 'PUT' | 'DELETE', body?: unknown): Promise<Response | null> {
		const token = deviceToken();
		if (!token) return null;
		const response = await fetch('/api/push/subscription', {
			method,
			headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
			body: body === undefined ? undefined : JSON.stringify(body),
		}).catch(() => null);
		if (response?.status === 401) sync.forget('This device was removed from sync.');
		return response;
	}

	#retry() {
		if (this.state.kind === 'unavailable' || this.state.kind === 'error') void this.detect();
		else if (this.state.kind === 'on') void this.#register(this.state.subscription);
	}

	async #expire() {
		this.#registered = null;
		this.state = { kind: 'off' };
		await this.#call('DELETE');
		await this.#unsubscribe();
	}

	async #unsubscribe() {
		const registration = await navigator.serviceWorker.getRegistration();
		await (await registration?.pushManager.getSubscription())?.unsubscribe();
	}
}

export const push = new Push();

/** The short status the sidebar shows next to Notifications. */
export function pushStatus(state: PushState): string | null {
	switch (state.kind) {
		case 'checking':
			return null;
		case 'on':
			return 'On';
		case 'denied':
			return 'Blocked';
		case 'install':
			return 'Set up';
		case 'off':
		case 'enabling':
		case 'unpaired':
		case 'unsupported':
		case 'unavailable':
		case 'error':
			return 'Off';
		default: {
			const never: never = state;
			return never;
		}
	}
}

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

const JSON_HEADERS = { 'content-type': 'application/json' };

async function fetchKey(): Promise<Uint8Array<ArrayBuffer> | null> {
	const response = await fetch('/api/push/key').catch(() => null);
	if (!response?.ok) return null;
	const { publicKey } = (await response.json().catch(() => ({}))) as { publicKey?: unknown };
	if (typeof publicKey !== 'string' || !publicKey) return null;
	try {
		const base64 = publicKey.replaceAll('-', '+').replaceAll('_', '/');
		return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0));
	} catch {
		return null;
	}
}

/**
 * Moves a subscription made for a rotated server key to the current one. Permission is already granted, so this
 * needs no prompt. Browsers refuse a second key on a live subscription, so the old one goes first.
 */
async function resubscribe(
	registration: ServiceWorkerRegistration,
	stale: PushSubscription,
	key: Uint8Array<ArrayBuffer>,
): Promise<PushSubscription | null> {
	await stale.unsubscribe();
	return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => null);
}

function sameKey(current: ArrayBuffer | null, key: Uint8Array) {
	if (!current) return false;
	const bytes = new Uint8Array(current);
	return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
