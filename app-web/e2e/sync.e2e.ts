import type { Browser, BrowserContext, Page } from '@playwright/test';
import { SYNC_SETUP_CODE } from '../playwright.config.ts';
import { App, expect, NOW, test } from './fixtures.ts';

/**
 * Two browser contexts are two devices on the one dev account. The account is shared by every test in the run, so
 * each test uses its own task titles. "Offline" fails the device's sync requests instead of taking the whole
 * browser offline, which would also cut it off from the dev server.
 */

type Device = { app: App; page: Page; context: BrowserContext };

/** The Worker's account outlives a run, so titles carry a random suffix. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

// Only one pairing code is live at a time, so tests that pair must not overlap.
test.describe.configure({ mode: 'default' });

async function device(browser: Browser): Promise<Device> {
	const { baseURL, timezoneId, viewport } = test.info().project.use;
	const context = await browser.newContext({ baseURL, timezoneId, viewport });
	const page = await context.newPage();
	await page.clock.setFixedTime(NOW);
	await page.goto('/inbox');
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
	return { app: new App(page), page, context };
}

const status = (app: App) => app.settings().getByRole('status', { name: 'Sync status' });

async function setUp({ app }: Device) {
	await app.openSettings();
	await app.settings().getByRole('button', { name: 'Set up sync' }).click();
	await app.settings().getByRole('textbox', { name: 'Setup code' }).fill(SYNC_SETUP_CODE);
	await app.settings().getByRole('button', { name: 'Turn on sync' }).click();
	await expect(status(app)).toHaveText('Up to date');
}

/** Shows a code on `paired` and enters it on `other`, then closes Settings on both. */
async function pair(paired: Device, other: Device) {
	await paired.app.settings().getByRole('button', { name: 'Pair a device' }).click();
	const code = await paired.app.settings().getByRole('group', { name: 'Pairing code' }).locator('output').innerText();
	expect(code).toMatch(/^[A-Z2-9]{4} [A-Z2-9]{4}$/);
	await other.app.openSettings();
	await other.app.settings().getByRole('button', { name: 'Enter a pairing code' }).click();
	await other.app.settings().getByRole('textbox', { name: 'Pairing code' }).fill(code.toLowerCase());
	await other.app.settings().getByRole('button', { name: 'Pair' }).click();
	await expect(status(other.app)).toHaveText('Up to date');
	await expect(paired.app.settings().getByRole('group', { name: 'Pairing code' })).toBeHidden();
	for (const device of [paired, other]) await close(device);
}

async function close({ app, page }: Device) {
	await page.keyboard.press('Escape');
	await expect(app.settings()).toBeHidden();
}

async function pairedDevices(browser: Browser): Promise<[Device, Device]> {
	const a = await device(browser);
	const b = await device(browser);
	await setUp(a);
	await pair(a, b);
	return [a, b];
}

/** The window coming back into focus, one of the sync triggers. */
const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

const goOffline = ({ context }: Device) => context.route('**/api/sync', route => route.abort('internetdisconnected'));
const goOnline = ({ context }: Device) => context.unroute('**/api/sync');

/** Waits until the device has nothing left in its outbox. */
async function settled(device: Device) {
	await device.app.openSettings();
	await focus(device.page);
	await expect(status(device.app)).toHaveText('Up to date');
	await close(device);
}

async function rename(app: App, from: string, to: string) {
	await app
		.row(from)
		.getByRole('button', { name: new RegExp(from) })
		.click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.fill(to);
	await title.press('Enter');
	await app.details().getByRole('button', { name: 'Close' }).click();
}

test.afterEach(async ({ browser }) => {
	for (const context of browser.contexts()) await context.close();
});

test('pairing shows the other device, and a change on one shows on the other', async ({ browser }) => {
	const [a, b] = await pairedDevices(browser);
	await a.app.openSettings();
	const devices = a.app.settings().getByRole('list', { name: 'Devices' });
	await expect(devices.getByText('This device')).toHaveCount(1);
	await expect(devices.getByRole('listitem')).not.toHaveCount(1);
	await close(a);

	const title = unique('Synced task');
	await a.app.add(title);
	await settled(a);
	await focus(b.page);
	await expect(b.app.row(title)).toBeVisible();

	await b.app
		.row(title)
		.getByRole('checkbox', { name: `Complete ${title}` })
		.click();
	await expect(b.app.row(title)).toHaveCount(0);
	await settled(b);
	await focus(a.page);
	await expect(a.app.row(title)).toHaveCount(0);
});

test('changes made offline apply at once and upload when the network returns', async ({ browser }) => {
	const [a, b] = await pairedDevices(browser);
	const kept = unique('Kept offline');
	const later = unique('Added offline');
	await a.app.add(kept);
	await settled(a);

	await goOffline(a);
	await a.app.add(later);
	await rename(a.app, kept, `${kept} renamed`);
	await expect(a.app.row(later)).toBeVisible();
	await a.app.openSettings();
	await focus(a.page);
	await expect(status(a.app)).toHaveText(/Offline · \d+ changes? waiting/);
	await close(a);

	await a.page.reload();
	await expect(a.app.row(later)).toBeVisible();

	await goOnline(a);
	await settled(a);
	await focus(b.page);
	await expect(b.app.row(later)).toBeVisible();
	await expect(b.app.row(`${kept} renamed`)).toBeVisible();
});

test('both devices editing the same task offline converge', async ({ browser }) => {
	const [a, b] = await pairedDevices(browser);
	const title = unique('Shared');
	await a.app.add(title);
	await settled(a);
	await focus(b.page);
	await expect(b.app.row(title)).toBeVisible();

	await goOffline(a);
	await goOffline(b);
	await rename(a.app, title, `${title} from A`);
	await rename(b.app, title, `${title} from B`);
	await b.app
		.row(`${title} from B`)
		.getByRole('button', { name: new RegExp(title) })
		.click();
	await b.app.details().getByRole('textbox', { name: 'Notes' }).fill('Notes from B');
	await b.app.details().getByRole('button', { name: 'Close' }).click();

	await goOnline(a);
	await settled(a);
	await goOnline(b);
	await settled(b);
	await settled(a);

	const rowA = a.app.list('Inbox tasks').getByRole('listitem').filter({ hasText: title });
	const rowB = b.app.list('Inbox tasks').getByRole('listitem').filter({ hasText: title });
	await expect(rowA).toHaveCount(1);
	await expect(rowA).toContainText('Notes from B');
	await expect(rowB).toHaveCount(1);
	const winner = await b.page.locator(`[data-task^="${title}"]`).getAttribute('data-task');
	expect([`${title} from A`, `${title} from B`]).toContain(winner);
	await expect(a.app.row(winner!)).toBeVisible();
});

test('removing a device turns sync off there and keeps its tasks', async ({ browser }) => {
	const [a, b] = await pairedDevices(browser);
	const title = unique('Before removal');
	await b.app.add(title);
	await settled(b);
	await settled(a);
	await expect(a.app.row(title)).toBeVisible();

	await a.app.openSettings();
	const devices = a.app.settings().getByRole('list', { name: 'Devices' });
	await expect(devices).toBeVisible();
	const own = devices.getByRole('button', { name: /\(this device\)$/ });
	await own.click();
	await expect(a.app.settings().getByRole('button', { name: 'Set up sync' })).toBeVisible();
	await expect(a.app.row(title)).toBeVisible();
	expect(await a.page.evaluate(() => localStorage.getItem('procrastimate-device'))).toBeNull();
	expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('procrastimate')!).sync)).toBeUndefined();
});
