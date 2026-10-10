import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import { pushSubscriptionSchema, type PushSubscriptionInfo, type ScheduleRequest } from 'shared/push.ts';
import { notificationTimes, type Due, type Reminder } from 'shared/task.ts';
import { pushSchedule } from './push-schedule.ts';
import { store } from './store.svelte.ts';
import { sheets, toasts } from './ui.svelte.ts';

/** Where this device stands with Web Push. Each kind is one view in the Notifications sheet. */
export type PushState =
	| { kind: 'checking' }
	| { kind: 'unsupported' }
	/** An iPhone or iPad Safari tab: Push exists only after Add to Home Screen. */
	| { kind: 'install' }
	/** The server has no push key, as with the local Bun dev server. */
	| { kind: 'unavailable' }
	/** Permission not asked yet, or granted without a subscription. */
	| { kind: 'off' }
	| { kind: 'enabling' }
	| { kind: 'denied' }
	| { kind: 'on'; subscription: PushSubscriptionInfo }
	| { kind: 'error'; message: string };

/** Chromium's install prompt, which lib.dom does not type. */
type InstallPromptEvent = Event & { prompt: () => Promise<unknown> };

const SYNC_DELAY = 300;
/** Browsers reject a `keepalive` request whose body exceeds 64 KiB, so a larger schedule syncs without it. */
const KEEPALIVE_LIMIT = 60_000;

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
	#lastSent: string | null = null;
	#pending: string | null = null;
	#failed = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#sending: Promise<void> = Promise.resolve();

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
			[document, 'visibilitychange', () => (document.visibilityState === 'visible' ? this.#retry() : this.#flush())],
			[window, 'pagehide', () => this.#flush()],
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
		if (Notification.permission === 'denied') return { kind: 'denied' };
		const registration = await navigator.serviceWorker.getRegistration();
		const subscription = await registration?.pushManager.getSubscription();
		if (!subscription) return { kind: 'off' };
		if (Notification.permission === 'granted' && sameKey(subscription.options.applicationServerKey, key)) {
			return { kind: 'on', subscription: pushSubscriptionSchema.parse(subscription.toJSON()) };
		}
		// A rotated server key or a reset permission leaves a subscription the server can no longer use.
		await subscription.unsubscribe();
		return { kind: 'off' };
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
			this.state = { kind: 'on', subscription: pushSubscriptionSchema.parse(subscription.toJSON()) };
		} catch (error) {
			this.state = { kind: 'error', message: messageOf(error) };
		}
	}

	async disable() {
		if (this.state.kind !== 'on') return;
		const { endpoint } = this.state.subscription;
		this.#stopSync();
		this.state = { kind: 'off' };
		await fetch('/api/push/schedule', {
			method: 'DELETE',
			headers: JSON_HEADERS,
			body: JSON.stringify({ endpoint }),
		}).catch(() => {});
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
		if (this.#nudged || (this.state.kind !== 'off' && this.state.kind !== 'install')) return;
		if (!notificationTimes(due, reminders).length) return;
		this.#nudged = true;
		toasts.show('Get notified when it’s due?', { label: 'Turn on', run: () => sheets.openNotifications() }, 8000);
	}

	/** Replaces the server's schedule for this device. The first sync after turning on or starting goes out at once. */
	sync() {
		if (this.state.kind !== 'on') return;
		const request: ScheduleRequest = {
			subscription: this.state.subscription,
			notifications: pushSchedule(store.tasks, Date.now()),
		};
		const body = JSON.stringify(request);
		if (body === this.#lastSent) {
			this.#pending = null;
			return;
		}
		this.#pending = body;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.#flush(), this.#lastSent === null ? 0 : SYNC_DELAY);
	}

	#flush() {
		clearTimeout(this.#timer);
		if (this.#pending === null) return;
		this.#sending = this.#sending.then(() => this.#send());
	}

	/** Sends run one at a time and always send the latest schedule, so an older one never lands last. */
	async #send() {
		const body = this.#pending;
		if (body === null) return;
		this.#pending = null;
		const response = await fetch('/api/push/schedule', {
			method: 'PUT',
			headers: JSON_HEADERS,
			body,
			keepalive: body.length < KEEPALIVE_LIMIT,
		}).catch(() => null);
		if (response?.status === 410) return this.#expire();
		if (response?.ok) {
			this.#lastSent = body;
			this.#failed = false;
			return;
		}
		this.#failed = true;
		this.#pending ??= body;
	}

	#retry() {
		if (this.state.kind === 'unavailable' || this.state.kind === 'error') void this.detect();
		else if (this.#failed) this.#flush();
	}

	#stopSync() {
		clearTimeout(this.#timer);
		this.#pending = null;
		this.#lastSent = null;
		this.#failed = false;
	}

	async #expire() {
		this.#stopSync();
		this.state = { kind: 'off' };
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

function sameKey(current: ArrayBuffer | null, key: Uint8Array) {
	if (!current) return false;
	const bytes = new Uint8Array(current);
	return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
