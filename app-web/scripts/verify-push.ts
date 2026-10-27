/**
 * Proves Web Push end to end with a real push service: headless Google Chrome turns on sync and subscribes through
 * FCM, the Worker at BASE_URL computes the schedule from the synced tasks and sends, and the service worker shows the
 * notifications while no app page is open.
 *
 *   bun app-web/scripts/verify-push.ts [BASE_URL]   (default http://localhost:8787)
 *
 * Needs Google Chrome (CHROME, default its macOS app or /usr/local/bin/google-chrome). Playwright's Chromium has no FCM keys, and
 * incognito contexts cannot subscribe, so this uses a persistent profile.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { DEVICE_HEADER } from '../../shared/auth';
import { DELIVERY_CRON } from '../../server/src/crons';
import { SEND_HOLD_MS } from '../../server/src/push-schedule';

const BASE_URL = process.argv[2] ?? 'http://localhost:8787';
const CHROME =
	process.env.CHROME ??
	(process.platform === 'darwin'
		? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
		: '/usr/local/bin/google-chrome');
/** `wrangler dev` runs no Cron Triggers on its own; `scripts/wrangler-dev.ts` passes `--test-scheduled` to fire them. */
const LOCAL = ['localhost', '127.0.0.1'].includes(new URL(BASE_URL).hostname);
/** The account outlives a run, so this run's titles carry a suffix. */
const RUN = crypto.randomUUID().slice(0, 4);

const log = (step: string, detail?: unknown) =>
	console.log(`${new Date().toISOString()} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);

function check(ok: boolean, step: string, detail?: unknown): asserts ok {
	log(`${ok ? 'PASS' : 'FAIL'} ${step}`, detail);
	if (!ok) process.exit(1);
}

const pad = (n: number) => String(n).padStart(2, '0');

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'verify-push-')), {
	executablePath: CHROME,
	headless: process.env.HEADED !== '1',
	baseURL: BASE_URL,
	viewport: { width: 1280, height: 800 },
});
await context.grantPermissions(['notifications'], { origin: new URL(BASE_URL).origin });
/** The app reports a failed subscribe only to Sentry, so the page records it here for a failed run to print. */
await context.addInitScript(() => {
	const errors: string[] = [];
	Object.assign(window, { pushErrors: errors });
	const subscribe = PushManager.prototype.subscribe;
	PushManager.prototype.subscribe = function (...args) {
		return subscribe.apply(this, args).catch((error: unknown) => {
			errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
			throw error;
		});
	};
});

const shown = (page: Page) =>
	page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		return (await registration.getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag }));
	});

const schedule = async (page: Page) => {
	const deviceId = await page.evaluate(() => localStorage.getItem('procrastimate-install') ?? '');
	const response = await page.request.get('/api/push/schedule', { headers: { [DEVICE_HEADER]: deviceId } });
	const { notifications } = (await response.json()) as {
		notifications: { title: string; body: string; at: number }[];
	};
	return notifications.flatMap(n => named(n).map(name => `${name}@${new Date(n.at).toISOString()}`));
};

/** The run's tasks a notification names: its title alone, or the titles a group lists in its body. */
const named = (n: { title: string; body: string }) =>
	(/^\d+ tasks/.test(n.title) ? n.body.split(', ') : [n.title])
		.filter(name => name.endsWith(` ${RUN}`))
		.map(name => name.replace(` ${RUN}`, ''));

const failedPushRoutes: string[] = [];
/** Why subscribing failed: the browser's subscribe errors, failed push routes, and what the page holds. */
const pushFailure = async (page: Page) => ({
	line: await page.getByText(/^Notifications/).allTextContents(),
	failedPushRoutes,
	...(await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.getRegistration();
		return {
			subscribeErrors: (window as unknown as { pushErrors: string[] }).pushErrors,
			permission: Notification.permission,
			subscription: (await registration?.pushManager.getSubscription())?.endpoint ?? null,
			refusedAt: localStorage.getItem('procrastimate-push-refused-at'),
		};
	})),
});

const signed = await context.request.post('/api/auth/sign-up/email', {
	data: { email: `push-${RUN}@example.com`, password: 'e2e-password-1', name: 'Push' },
});
if (!signed.ok()) throw new Error(await signed.text());

const page = await context.newPage();
page.on('response', response => {
	if (new URL(response.url()).pathname.startsWith('/api/push/') && !response.ok())
		failedPushRoutes.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
});
await page.goto('/inbox');
const nav = page.getByRole('navigation', { name: 'Main' });
const settings = page.getByRole('dialog', { name: 'Settings' });
await expect
	.poll(() => page.evaluate(() => localStorage.getItem('procrastimate-user')), { timeout: 15_000 })
	.toBeTruthy();
log('PASS sync is on');
await nav.getByRole('button', { name: 'Settings' }).click();
const on = await expect(settings.getByText('Notifications: On', { exact: true }))
	.toBeVisible({ timeout: 20_000 })
	.then(() => true)
	.catch(() => false);
check(on, 'Notifications: On', on ? undefined : await pushFailure(page));
await page.keyboard.press('Escape');
const endpoint = await page.evaluate(async () => {
	const registration = await navigator.serviceWorker.ready;
	return (await registration.pushManager.getSubscription())?.endpoint ?? '';
});
check(
	endpoint.startsWith('https://fcm.googleapis.com/'),
	'subscribed through a real push service',
	endpoint.slice(0, 48),
);

const subscription = await page.evaluate(async () => {
	const registration = await navigator.serviceWorker.ready;
	return (await registration.pushManager.getSubscription())?.toJSON();
});
const subscribedAt = Date.now();
/**
 * The first whole minute the cron sends to this subscription, after its hold on a new subscription's sends. That
 * leaves the tasks below time to save and sync before it.
 */
const target = new Date(Math.ceil((subscribedAt + SEND_HOLD_MS) / 60_000) * 60_000);
const clock = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
const later = `${pad((target.getHours() + 1) % 24)}:${pad(target.getMinutes())}`;

async function add(title: string) {
	await page.locator('body').click({ position: { x: 1200, y: 700 } });
	await page.keyboard.press('q');
	const quickAdd = page.getByRole('dialog', { name: 'Quick add' });
	const input = quickAdd.getByRole('textbox', { name: 'Task name' });
	await expect(input).toBeFocused();
	await input.fill(title);
	await input.press('Enter');
	await expect(input).toHaveValue('');
	await page.keyboard.press('Escape');
	await expect(quickAdd).toBeHidden();
}

async function openTask(title: string) {
	await page
		.locator(`[data-task="${title} ${RUN}"]`)
		.getByRole('button', { name: `${title} ${RUN}`, exact: true })
		.click();
	return page.getByRole('dialog', { name: 'Task details' });
}

log('scheduling for', { clock, target: target.toISOString() });
await add(`Due and reminded ${RUN} ${clock} remind me at ${clock}`);
await add(`Daily repeat ${RUN} every day ${clock}`);
await add(`Deleted ${RUN} ${clock}`);
await add(`Completed ${RUN} ${clock}`);
await add(`Edited ${RUN} ${clock}`);
await add(`Date only ${RUN} today`);
await nav.getByRole('link', { name: 'Inbox' }).click();

await (await openTask('Deleted')).getByRole('button', { name: 'Delete task' }).click();
await page
	.locator(`[data-task="Completed ${RUN}"]`)
	.getByRole('checkbox', { name: `Complete Completed ${RUN}` })
	.click();
const edited = (await openTask('Edited')).getByRole('textbox', { name: 'Title' });
await edited.fill(`Edited ${RUN} ${later}`);
await edited.press('Enter');
await page.keyboard.press('Escape');

const at = target.toISOString();
const expected = [`Due and reminded@${at}`, `Daily repeat@${at}`].sort();
let pending: string[] = [];
for (const start = Date.now(); Date.now() - start < 10_000; await page.waitForTimeout(250)) {
	pending = (await schedule(page)).filter(entry => entry.endsWith(at)).sort();
	if (JSON.stringify(pending) === JSON.stringify(expected)) break;
}
check(
	JSON.stringify(pending) === JSON.stringify(expected),
	'server holds one push naming both live tasks, without deleted, completed, edited, or date-only tasks',
	await schedule(page),
);

await page.close();
log('app closed; waiting for the due time');
/**
 * The test push goes out only now, over a minute after subscribing. FCM is slow to accept a token Chrome just
 * registered: for up to about 10 s it answers 410 Gone, or it accepts pushes and never delivers them, for up to about
 * 25 s. Chrome's registration has already succeeded and the subscription never changes, so nothing on the client marks
 * the end.
 */
const wait = target.getTime() + 15_000 - Date.now();
await new Promise(resolve => setTimeout(resolve, wait));
const test = await context.request.post('/api/push/test', { data: { subscription } });
check(test.ok(), 'test push accepted', test.status());
if (LOCAL) {
	const fired = await context.request.get(
		`/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(DELIVERY_CRON)}&time=${target.getTime()}`,
	);
	check(fired.ok(), 'fired the delivery cron on wrangler dev', fired.status());
}

const reopened = await context.newPage();
await reopened.goto('/inbox');
let testArrived = false;
for (const start = Date.now(); Date.now() - start < 20_000; await reopened.waitForTimeout(250))
	if ((testArrived = (await shown(reopened)).some(n => n.tag === 'test'))) break;
check(testArrived, 'test push arrived through FCM and the service worker showed it');
/** The push left the server, but FCM hands it to Chrome on its own schedule. */
let delivered: Awaited<ReturnType<typeof shown>> = [];
for (const start = Date.now(); Date.now() - start < 20_000; await reopened.waitForTimeout(250)) {
	delivered = (await shown(reopened)).filter(n => n.tag !== 'test');
	if (delivered.length > 0) break;
}
check(
	delivered.length === 1 &&
		delivered[0]?.title === '2 tasks' &&
		JSON.stringify(named(delivered[0]).sort()) === JSON.stringify(['Daily repeat', 'Due and reminded']),
	'the two live tasks due at one moment notified once, together, while the app was closed',
	delivered,
);
check(
	(await schedule(reopened)).every(entry => !entry.endsWith(at)),
	'delivered pushes left the schedule',
);

await reopened
	.locator(`[data-task="Daily repeat ${RUN}"]`)
	.getByRole('checkbox', { name: `Complete Daily repeat ${RUN}` })
	.click();
const next = new Date(target.getTime() + 86_400_000).toISOString();
let afterRepeat: string[] = [];
for (const start = Date.now(); Date.now() - start < 10_000; await reopened.waitForTimeout(250)) {
	afterRepeat = await schedule(reopened);
	if (afterRepeat.includes(`Daily repeat@${next}`)) break;
}
check(
	afterRepeat.includes(`Daily repeat@${next}`),
	'completing the repeating task scheduled its next occurrence',
	afterRepeat,
);

await context.close();
log('all checks passed');
