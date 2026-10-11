import type { PushScheduleResponse } from 'shared/push.ts';
import { SYNC_SETUP_CODE } from '../../playwright.config.ts';
import { App, expect, NOW, test as base } from '../fixtures.ts';

export { NOW };
export const YESTERDAY = new Date(NOW.getTime() - 86_400_000);

/** The phone layout's handles, named like the XCUITests' `ParityHelpers`. */
export class PhoneApp extends App {
	checkbox = (title: string) => this.page.getByRole('checkbox', { name: `Complete ${title}` });
	toast = (text: string) => this.page.getByRole('status').filter({ hasText: text });
	highlight = (kind: string) => this.quickAdd().locator(`[data-token="${kind}"]`);

	async openQuickAdd() {
		await this.page.getByRole('button', { name: 'Quick add' }).tap();
		await expect(this.taskInput()).toBeFocused();
	}

	/** Adds each task with the keyboard's return key, then dismisses the sheet. */
	async add(...titles: string[]) {
		await this.openQuickAdd();
		for (const title of titles) {
			await this.taskInput().fill(title);
			await this.taskInput().press('Enter');
			await expect(this.taskInput()).toHaveValue('');
		}
		await this.cancelQuickAdd();
	}

	async type(text: string) {
		await this.taskInput().pressSequentially(text);
	}

	async cancelQuickAdd() {
		await this.quickAdd().getByRole('button', { name: 'Cancel' }).tap();
		await expect(this.quickAdd()).toBeHidden();
	}

	async go(view: string) {
		await this.page.getByRole('button', { name: 'Open navigation' }).tap();
		await this.nav(view).tap();
		await expect(this.page.getByRole('heading', { level: 1, name: view })).toBeVisible();
	}

	/** Reloads at another pinned moment on the same data, like the XCUITests' `relaunch`. */
	async relaunch(now: Date) {
		await this.setNow(now);
		await this.page.reload();
		await expect(this.page.getByRole('heading', { level: 1 })).toBeVisible();
	}

	drawer = () => this.page.getByRole('navigation', { name: 'Main' });
	notificationsRow = () => this.drawer().getByRole('button', { name: /^Notifications/ });
	notifications = () => this.page.getByRole('dialog', { name: 'Notifications' });

	/** The phone sidebar is the drawer, so Settings opens as a sheet from it. */
	override async openSettings() {
		await this.page.getByRole('button', { name: 'Open navigation' }).tap();
		await this.drawer().getByRole('button', { name: 'Settings' }).tap();
		await expect(this.settings()).toBeVisible();
	}

	async closeSettings() {
		await this.settings().getByRole('button', { name: 'Close settings' }).tap();
		await expect(this.settings()).toBeHidden();
	}

	async openNotifications(heading: string) {
		await this.page.getByRole('button', { name: 'Open navigation' }).tap();
		await this.notificationsRow().tap();
		await expect(this.notifications().getByRole('heading', { name: heading })).toBeVisible();
	}

	async closeNotifications() {
		await this.notifications().getByRole('button', { name: 'Close' }).tap();
		await expect(this.notifications()).toBeHidden();
	}

	/** The status next to Notifications in the drawer, which the Browse row shows on iOS. */
	async expectNotificationsStatus(status: string) {
		await this.page.getByRole('button', { name: 'Open navigation' }).tap();
		await expect(this.notificationsRow()).toHaveText(new RegExp(`^\\s*Notifications\\s*${status}\\s*$`));
		await this.page.keyboard.press('Escape');
	}

	/**
	 * Makes this page a Home Screen web app that can subscribe to push, the web's counterpart of a native app with
	 * notification permission. WebKit in Playwright has no push service, so the service worker registration,
	 * `PushManager`, and the permission prompt are stand-ins answering `permission`. Subscriptions still register
	 * with the real server, which computes the schedule from synced tasks.
	 */
	async mockPush(permission: 'granted' | 'denied') {
		await this.page.route('/api/push/key', route => route.fulfill({ json: { publicKey: PUSH_KEY } }));
		await this.page.route('/api/push/test', route => route.fulfill({ json: { ok: true } }));
		await this.page.addInitScript(
			([key, endpoint, outcome]) => {
				const bytes = Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
				let current: unknown = null;
				const pushManager = {
					getSubscription: async () => current,
					subscribe: async () =>
						(current = {
							endpoint,
							options: { applicationServerKey: bytes.buffer, userVisibleOnly: true },
							toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }),
							unsubscribe: async () => {
								current = null;
								return true;
							},
						}),
				};
				const registration = { pushManager, scope: '/' };
				const worker = Object.assign(new EventTarget(), {
					controller: null,
					ready: Promise.resolve(registration),
					register: async () => registration,
					getRegistration: async () => registration,
					getRegistrations: async () => [registration],
				});
				Object.defineProperty(navigator, 'serviceWorker', { get: () => worker, configurable: true });
				Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
				Object.assign(window, { PushManager: window.PushManager ?? function PushManager() {} });
				if (!('Notification' in window)) Object.assign(window, { Notification: function Notification() {} });
				let answer: NotificationPermission = 'default';
				Object.defineProperty(Notification, 'permission', { get: () => answer, configurable: true });
				Notification.requestPermission = async () => (answer = outcome);
			},
			// The server keeps one device per endpoint, so parallel tests each need their own.
			[PUSH_KEY, `https://push.example/${crypto.randomUUID()}`, permission] as const,
		);
		await this.page.reload();
		await expect(this.page.getByRole('heading', { level: 1 })).toBeVisible();
	}

	/** Web Push comes from the server, so the web needs this device paired before it can turn notifications on. */
	async setUpSync() {
		await this.openSettings();
		await this.settings().getByRole('button', { name: 'Set up sync' }).tap();
		await this.settings().getByRole('textbox', { name: 'Setup code' }).fill(SYNC_SETUP_CODE);
		await this.settings().getByRole('button', { name: 'Turn on sync' }).tap();
		await expect(this.settings().getByRole('status', { name: 'Sync status' })).toHaveText('Up to date');
		await this.closeSettings();
	}

	/** What the server will push to this device for `title`, as `title@<ISO time>: body`, like the iOS readout. */
	async serverSchedule(title: string) {
		const token = await this.page.evaluate(() => localStorage.getItem('procrastimate-device'));
		const response = await this.page.request.get('/api/push/schedule', {
			headers: { Authorization: `Bearer ${token}` },
		});
		const { notifications } = (await response.json()) as PushScheduleResponse;
		return notifications
			.filter(push => push.title === title)
			.map(push => `${push.title}@${new Date(push.at).toISOString()}: ${push.body}`);
	}
}

const PUSH_KEY = Buffer.from(Array.from({ length: 65 }, (_, i) => i)).toString('base64url');

/**
 * The web half of the iOS parity pairs. `app` launches like the XCUITests' `launch()`: a fresh profile at the pinned
 * moment, opened at `/`. `snap` saves `test-results/parity/<parity-id>.png` for the side-by-side report.
 */
export const test = base.extend<{ app: PhoneApp; snap: (id: string) => Promise<void> }>({
	app: async ({ page }, use) => {
		await page.clock.setFixedTime(NOW);
		await page.goto('/');
		// The first specs of a run wait on the dev server's cold compile.
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
		await use(new PhoneApp(page));
	},
	snap: async ({ page }, use) => {
		await use(async id => {
			await new App(page).settle();
			await page.screenshot({ path: `test-results/parity/${id}.png` });
		});
	},
});

export { expect };
