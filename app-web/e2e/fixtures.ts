import { expect, test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { getTableColumns } from 'drizzle-orm';
import { ENTITY_TABLES } from '../../shared/db/schema';
import type { Kind } from '../../shared/model';
import { TABLE_OF } from '../../shared/rows';
import { todoistBackupFiles } from '../../shared/fixtures/todoist-backup.mts';
import { SENTRY_TUNNEL_PATH } from '../../shared/sentry';

/** Wednesday, October 14 2026, 10:00 UTC. The suite runs in the UTC time zone. */
export const NOW = new Date('2026-10-14T10:00:00Z');

export const E2E_PASSWORD = 'e2e-password-1';

/** Each worker process's own, so a test's account is new on every run of a database that outlives the run. */
const RUN = crypto.randomUUID().slice(0, 8);

/** One user per test. A second context signs in as the same email, so the two devices share an account. */
export function e2eEmail(): string {
	const id = test
		.info()
		.testId.replace(/[^A-Za-z0-9]/g, '')
		.slice(0, 40);
	return `e2e-${id}-${RUN}@procrastimate.test`;
}

/**
 * A title that is new on an account that outlives the run, as the Worker's does. The suffix starts with a letter
 * so quick add never reads it as a token: a bare hex id such as `3929284d` is a due date 3,929,284 days away.
 */
export const unique = (name: string) => `${name} x${crypto.randomUUID().slice(0, 8)}`;

/**
 * A new context like the project's own, so the mobile project's extra devices are phones too. Its service worker is
 * blocked: WebKit sends a page's requests through it, where `context.route` never sees them.
 */
export async function deviceContext(browser: Browser, { timezoneId }: { timezoneId?: string } = {}) {
	const { baseURL, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, ...use } = test.info().project.use;
	return browser.newContext({
		baseURL,
		timezoneId: timezoneId ?? use.timezoneId,
		viewport,
		isMobile,
		hasTouch,
		userAgent,
		deviceScaleFactor,
		serviceWorkers: 'block',
	});
}

const SYNC_ROUTES = /\/api\/(powersync\/|upload|sync\/token)/;

/** Cuts the context's network and refuses the sync routes, so PowerSync's stream drops and its uploads fail. */
export async function goOffline(context: BrowserContext) {
	await context.route(SYNC_ROUTES, route => route.abort('internetdisconnected'));
	await context.setOffline(true);
}

export async function goOnline(context: BrowserContext) {
	await context.setOffline(false);
	await context.unroute(SYNC_ROUTES);
}

export async function signInAccount(context: BrowserContext) {
	const email = e2eEmail();
	const signUp = await context.request.post('/api/auth/sign-up/email', {
		data: { email, password: E2E_PASSWORD, name: 'E2E' },
	});
	if (signUp.ok()) return;
	const signIn = await context.request.post('/api/auth/sign-in/email', {
		data: { email, password: E2E_PASSWORD },
	});
	if (!signIn.ok()) throw new Error(`sign-in failed: ${signIn.status()} ${await signIn.text()}`);
}

/**
 * Collects every uncaught error in the context's pages. The pinned clock runs timer callbacks itself and logs what
 * they throw with `console.error(error)` instead of letting it escape, so a console error whose first argument is an
 * Error counts too. The app never logs an Error itself, and the browser's own lines, such as `Failed to load
 * resource`, carry no arguments.
 */
export function watchPageErrors(context: BrowserContext) {
	const errors: string[] = [];
	const pending: Promise<void>[] = [];
	context.on('weberror', error => errors.push(String(error.error())));
	context.on('console', message => {
		const [first] = message.type() === 'error' ? message.args() : [];
		if (!first) return;
		pending.push(
			first
				.evaluate(value => (value instanceof Error ? String(value) : null))
				.then(
					error => {
						if (error) errors.push(error);
					},
					// The page navigated before the argument could be read, so judge by the logged text.
					() => {
						if (/^\w*Error\b/.test(message.text())) errors.push(message.text());
					},
				),
		);
	});
	return async () => {
		await Promise.all(pending);
		return errors;
	};
}

/** Signed out. Every spec imports `test` from here, never from `@playwright/test`, so none can report to Sentry. */
export const quietTest = base.extend<{ sentryOff: (context: BrowserContext) => BrowserContext }>({
	// Every context, the default one and each spec's own `browser.newContext()`, so a test can never report to Sentry.
	sentryOff: [
		async ({ browser }, use) => {
			const reported: string[] = [];
			const watch = (watched: BrowserContext) => {
				// An initialized SDK tags the first API call with `sentry-trace`, long before it posts an envelope.
				watched.on('request', request => {
					const { pathname } = new URL(request.url());
					if (pathname === SENTRY_TUNNEL_PATH || request.headers()['sentry-trace']) reported.push(pathname);
				});
				return watched;
			};
			const newContext = browser.newContext;
			browser.newContext = async options => watch(await newContext.call(browser, options));
			await use(watch);
			browser.newContext = newContext;
			expect(reported, 'Sentry is off in tests').toEqual([]);
		},
		{ auto: true },
	],
});

/** Signed in, with uncaught page errors failing the test. */
export const test = quietTest.extend<{ app: App }>({
	context: async ({ context, sentryOff }, use) => {
		sentryOff(context);
		await signInAccount(context);
		const errors = watchPageErrors(context);
		await use(context);
		expect(await errors(), 'uncaught page errors').toEqual([]);
	},
	app: async ({ page }, use) => {
		await page.clock.setFixedTime(NOW);
		await page.goto('/inbox');
		await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
		// Until the web font arrives, text wraps in the much wider fallback, and specs measure layout.
		await page.evaluate(() => document.fonts.ready.then(() => undefined));
		await use(new App(page));
	},
});

export { expect };

export class App {
	constructor(readonly page: Page) {}

	quickAdd = () => this.page.getByRole('dialog', { name: 'Quick add' });
	taskInput = () => this.quickAdd().getByRole('textbox', { name: 'Task name' });
	details = () => this.page.getByRole('dialog', { name: 'Task details' });
	/** Skips a row animating out, which `leaving` hides from assistive tech, so a moving row resolves once. */
	row = (title: string) => this.page.locator(`[data-task="${title}"]:not([aria-hidden="true"] *)`);
	list = (name: string) => this.page.getByRole('list', { name });
	nav = (name: string) => this.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name });

	/** A phone has no keyboard shortcut, so it uses the floating button. */
	async openQuickAdd() {
		if (this.page.viewportSize()!.width < 768) {
			await this.page.getByRole('button', { name: 'Quick add' }).click();
		} else {
			await this.page.locator('body').click({ position: { x: 1200, y: 700 } });
			await this.page.keyboard.press('q');
		}
		await expect(this.taskInput()).toBeFocused();
	}

	/** Saving closes quick add, so each task opens it again. */
	async add(...titles: string[]) {
		for (const title of titles) {
			await this.openQuickAdd();
			await this.taskInput().fill(title);
			await this.taskInput().press('Enter');
			await expect(this.quickAdd()).toBeHidden();
		}
	}

	/** Opens the phone's drawer, unless it is open already. */
	async openNavigation() {
		if (await this.page.getByRole('navigation', { name: 'Main' }).isVisible()) return;
		await this.page.getByRole('button', { name: 'Open navigation' }).tap();
		await expect(this.page.getByRole('navigation', { name: 'Main' })).toBeInViewport();
	}

	/** Like `add`, but first creates each unknown #project and @label from its chip, as a person would. */
	async addCreating(title: string) {
		await this.openQuickAdd();
		await this.taskInput().fill(title);
		for (const [, name] of title.matchAll(/(?:^|\s)([#@][^\s#@]+)/g)) {
			const create = this.quickAdd().getByRole('button', { name: `Create ${name}`, exact: true });
			const parsed = this.quickAdd().locator('[data-token]').getByText(name!, { exact: true });
			await expect(create.or(parsed).first()).toBeVisible();
			if (await parsed.isVisible()) continue;
			await create.click();
			await expect(parsed).toBeVisible();
		}
		await this.taskInput().press('Enter');
		await expect(this.quickAdd()).toBeHidden();
	}

	async closeDetails() {
		await this.details().getByRole('button', { name: 'Close' }).click();
		await expect(this.details()).toBeHidden();
	}

	/** A phone has no keyboard shortcut, so it opens search from the drawer. */
	async openSearch() {
		if (this.page.viewportSize()!.width < 768) {
			await this.openNavigation();
			await this.page
				.getByRole('navigation', { name: 'Main' })
				.getByRole('button', { name: /^Search/ })
				.click();
		} else {
			await this.page.keyboard.press('/');
		}
		await expect(this.page.getByRole('combobox', { name: 'Search' })).toBeFocused();
	}

	async go(view: string) {
		await this.nav(view).click();
		await expect(this.page.getByRole('heading', { level: 1, name: view })).toBeVisible();
	}

	async createProject(name: string) {
		if (this.page.viewportSize()!.width < 768) await this.openNavigation();
		await this.page.getByRole('button', { name: 'Add project' }).click();
		const input = this.page.getByRole('textbox', { name: 'Project name' });
		await input.fill(name);
		await input.press('Enter');
		await expect(this.page.getByRole('heading', { level: 1, name })).toBeVisible();
	}

	/**
	 * Waits until no animation runs. A Svelte transition first plays a zero-length placeholder and starts the real
	 * animation from its `finish` handler, so waiting once on the animations present returns mid-transition. Each
	 * round waits on `finish` or `cancel` events, which fire after Svelte's handler has started what comes next.
	 */
	settle() {
		return this.page.evaluate(async () => {
			const running = () => document.getAnimations().filter(animation => animation.playState === 'running');
			for (let busy = running(); busy.length; busy = running()) {
				await Promise.race(
					busy.map(
						animation =>
							new Promise(done => {
								animation.addEventListener('finish', done, { once: true });
								animation.addEventListener('cancel', done, { once: true });
							}),
					),
				);
			}
		});
	}

	async taskId(title: string): Promise<string> {
		const id = await this.page.evaluate(title => window.procrastimate.taskId(title), title);
		if (!id) throw new Error(`no task titled ${title}`);
		return id;
	}

	/** Writes that have not reached the server yet, the local queue included. */
	pending() {
		return this.page.evaluate(() => window.procrastimate.pending());
	}

	/**
	 * Patches rows as another device of the same account would, through the upload route, once this page's own writes
	 * are on the server, and waits for PowerSync to stream them back here. Use it for fields the web cannot set, such
	 * as an iOS place.
	 */
	async pushFromOtherDevice(...patches: { kind: Kind; id: string; fields: Record<string, unknown> }[]) {
		await expect.poll(() => this.pending(), { timeout: 15_000 }).toBe(0);
		const writes = patches.map(({ kind, id, fields }) => {
			const columns = getTableColumns(ENTITY_TABLES[kind]) as Record<string, { name: string; dataType: string }>;
			const values = Object.fromEntries(
				Object.entries(fields).map(([key, value]) => [
					columns[key]!.name,
					value !== null && typeof value === 'object' ? JSON.stringify(value) : value,
				]),
			);
			return { op: 'patch', table: TABLE_OF[kind], id, values };
		});
		const response = await this.page.request.post('/api/upload', { data: { writes } });
		expect(response.status()).toBe(200);
		expect((await response.json()).rejected).toEqual([]);
		for (const { kind, id, fields } of patches) {
			await expect
				.poll(() => this.page.evaluate(([kind, id]) => window.procrastimate.entity(kind!, id!), [kind, id]))
				.toMatchObject(fields);
		}
	}

	async setNow(date: Date) {
		await this.page.clock.setFixedTime(date);
	}

	settings = () => this.page.getByRole('dialog', { name: 'Settings' });
	importSummary = () => this.settings().getByRole('status', { name: 'Import summary' });

	async openSettings() {
		if (this.page.viewportSize()!.width < 768) await this.openNavigation();
		await this.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Settings' }).click();
		await expect(this.settings()).toBeVisible();
	}

	themeOption = (name: 'System' | 'Light' | 'Dark') =>
		this.settings().getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name });

	dictationOption = (name: 'Native' | 'ElevenLabs') =>
		this.settings().getByRole('radiogroup', { name: 'Dictation' }).getByRole('radio', { name });

	async importBackup(press: 'click' | 'tap' = 'click') {
		const chooser = this.page.waitForEvent('filechooser');
		await this.settings().getByRole('button', { name: 'Import from Todoist' })[press]();
		await (await chooser).setFiles(todoistBackupZip());
	}

	async expectTheme(theme: 'light' | 'dark') {
		await expect(this.page.locator('html')).toHaveAttribute('data-theme', theme);
		await expect(this.page.locator('body')).toHaveCSS(
			'background-color',
			theme === 'dark' ? 'rgb(14, 14, 16)' : 'rgb(246, 246, 247)',
		);
		await this.expectChrome(theme);
	}

	async expectChrome(theme: 'light' | 'dark') {
		await expect(this.page.locator('meta[name="theme-color"]')).toHaveAttribute(
			'content',
			theme === 'dark' ? '#0e0e10' : '#f6f6f7',
		);
	}

	/**
	 * Reloads and snapshots the page the moment `<body>` is parsed. Nothing can paint before that,
	 * and the app's deferred module scripts have not run yet, so this is what the first frame uses.
	 */
	async expectFirstPaintTheme(theme: 'light' | 'dark') {
		await this.page.addInitScript(() => {
			new MutationObserver((_, observer) => {
				if (!document.body) return;
				observer.disconnect();
				const root = document.documentElement;
				sessionStorage.setItem(
					'first-paint',
					JSON.stringify({
						theme: root.dataset.theme,
						colorScheme: getComputedStyle(root).colorScheme,
						chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
					}),
				);
			}).observe(document, { childList: true, subtree: true });
		});
		await this.page.evaluate(() => sessionStorage.removeItem('first-paint'));
		await this.page.reload();
		await expect(this.page.getByRole('heading', { level: 1 })).toBeVisible();
		expect(JSON.parse((await this.page.evaluate(() => sessionStorage.getItem('first-paint')))!)).toEqual({
			theme,
			colorScheme: theme,
			chrome: theme === 'dark' ? '#0e0e10' : '#f6f6f7',
		});
	}
}

/** The synthetic backup zipped like Todoist zips one, plus the macOS metadata a re-zipped folder picks up. */
export const todoistBackupZip = () => ({
	name: 'todoist-backup-2026-10-14.zip',
	mimeType: 'application/zip',
	buffer: Buffer.from(zipSync(Object.fromEntries(todoistBackupFiles.map(file => [file.name, strToU8(file.text)])))),
});
