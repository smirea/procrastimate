/**
 * Proves Web Push end to end with a real push service: headless Google Chrome subscribes through FCM, the Worker at
 * BASE_URL schedules and sends, and the service worker shows the notifications while no app page is open.
 *
 *   bun app-web/scripts/verify-push.ts [BASE_URL]   (default http://localhost:8787, from `bun run preview`)
 *
 * Needs Google Chrome (CHROME, default /usr/local/bin/google-chrome). Playwright's Chromium has no FCM keys, and
 * incognito contexts cannot subscribe, so this uses a persistent profile.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';

const BASE_URL = process.argv[2] ?? 'http://localhost:8787';
const CHROME = process.env.CHROME ?? '/usr/local/bin/google-chrome';

const log = (step: string, detail?: unknown) =>
	console.log(`${new Date().toISOString()} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);

function check(ok: boolean, step: string, detail?: unknown): asserts ok {
	log(`${ok ? 'PASS' : 'FAIL'} ${step}`, detail);
	if (!ok) process.exit(1);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The first whole minute at least 40 s away, so the tasks below are saved and synced before it. */
const target = new Date(Math.ceil((Date.now() + 40_000) / 60_000) * 60_000);
const clock = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
const later = `${pad((target.getHours() + 1) % 24)}:${pad(target.getMinutes())}`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'verify-push-')), {
	executablePath: CHROME,
	headless: process.env.HEADED !== '1',
	baseURL: BASE_URL,
	viewport: { width: 1280, height: 800 },
});
await context.grantPermissions(['notifications'], { origin: new URL(BASE_URL).origin });

const shown = (page: Page) =>
	page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		return (await registration.getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag }));
	});

const schedule = async (page: Page, endpoint: string) => {
	const response = await page.request.get(`/api/push/schedule?endpoint=${encodeURIComponent(endpoint)}`);
	const { notifications } = (await response.json()) as { notifications: { title: string; at: number }[] };
	return notifications.map(n => `${n.title}@${new Date(n.at).toISOString()}`);
};

const page = await context.newPage();
await page.goto('/inbox');
const sheet = page.getByRole('dialog', { name: 'Notifications' });
const nav = page.getByRole('navigation', { name: 'Main' });
await nav.getByRole('button', { name: /^Notifications/ }).click();
await sheet.getByRole('button', { name: 'Turn on notifications' }).click();
await sheet.getByRole('heading', { name: 'Notifications are on' }).waitFor();
const endpoint = await page.evaluate(async () => {
	const registration = await navigator.serviceWorker.ready;
	return (await registration.pushManager.getSubscription())?.endpoint ?? '';
});
check(endpoint.startsWith('https://fcm.googleapis.com/'), 'subscribed through a real push service', endpoint.slice(0, 48));

await sheet.getByRole('button', { name: 'Send a test notification' }).click();
await sheet.getByRole('button', { name: 'Sent' }).waitFor();
const testShown = Date.now();
while (!(await shown(page)).some(n => n.tag === 'test') && Date.now() - testShown < 20_000) await page.waitForTimeout(250);
check((await shown(page)).some(n => n.tag === 'test'), 'test push arrived through FCM and the service worker showed it', {
	ms: Date.now() - testShown,
});
await page.keyboard.press('Escape');

async function add(title: string) {
	await page.locator('body').click({ position: { x: 1200, y: 700 } });
	await page.keyboard.press('q');
	const input = page.getByRole('dialog', { name: 'Quick add' }).getByRole('textbox', { name: 'Task name' });
	await input.fill(title);
	await input.press('Enter');
	await expect(input).toHaveValue('');
	await page.keyboard.press('Escape');
}

async function openTask(title: string) {
	await page.locator(`[data-task="${title}"]`).getByRole('button', { name: new RegExp(title) }).click();
	return page.getByRole('dialog', { name: 'Task details' });
}

log('scheduling for', { clock, target: target.toISOString() });
await add(`Due and reminded ${clock} remind me at ${clock}`);
await add(`Daily repeat every day ${clock}`);
await add(`Deleted ${clock}`);
await add(`Completed ${clock}`);
await add(`Edited ${clock}`);
await add('Date only today');
await nav.getByRole('link', { name: 'Today' }).click();

await (await openTask('Deleted')).getByRole('button', { name: 'Delete task' }).click();
await page.locator('[data-task="Completed"]').getByRole('checkbox', { name: 'Complete Completed' }).click();
const edited = (await openTask('Edited')).getByRole('textbox', { name: 'Title' });
await edited.fill(`Edited ${later}`);
await edited.press('Enter');
await page.keyboard.press('Escape');

const at = target.toISOString();
const expected = [`Due and reminded@${at}`, `Daily repeat@${at}`].sort();
let pending: string[] = [];
for (const start = Date.now(); Date.now() - start < 10_000; await page.waitForTimeout(250)) {
	pending = (await schedule(page, endpoint)).filter(entry => entry.endsWith(at)).sort();
	if (JSON.stringify(pending) === JSON.stringify(expected)) break;
}
check(JSON.stringify(pending) === JSON.stringify(expected), 'server holds one push per moment, without deleted, completed, edited, or date-only tasks', await schedule(page, endpoint));

await page.close();
log('app closed; waiting for the due time');
const wait = target.getTime() + 15_000 - Date.now();
await new Promise(resolve => setTimeout(resolve, wait));

const reopened = await context.newPage();
await reopened.goto('/today');
const delivered = (await shown(reopened)).filter(n => n.tag !== 'test');
check(
	JSON.stringify(delivered.map(n => n.title).sort()) === JSON.stringify(['Daily repeat', 'Due and reminded']),
	'only the two live tasks notified while the app was closed',
	delivered,
);
check((await schedule(reopened, endpoint)).every(entry => !entry.endsWith(at)), 'delivered pushes left the schedule');

await reopened.locator('[data-task="Daily repeat"]').getByRole('checkbox', { name: 'Complete Daily repeat' }).click();
const next = new Date(target.getTime() + 86_400_000).toISOString();
let afterRepeat: string[] = [];
for (const start = Date.now(); Date.now() - start < 10_000; await reopened.waitForTimeout(250)) {
	afterRepeat = await schedule(reopened, endpoint);
	if (afterRepeat.includes(`Daily repeat@${next}`)) break;
}
check(afterRepeat.includes(`Daily repeat@${next}`), 'completing the repeating task scheduled its next occurrence', afterRepeat);

await context.close();
log('all checks passed');
