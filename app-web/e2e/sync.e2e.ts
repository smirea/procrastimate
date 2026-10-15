import type { Browser, BrowserContext, Page } from '@playwright/test';
import { App, expect, NOW, signInAccount, test } from './fixtures.ts';

/**
 * Two browser contexts are two devices on this test's account. Sync starts on its own. Each test has its own
 * account, so titles only need to be unique inside the test. "Offline" fails the device's sync requests instead
 * of taking the whole browser offline, which would also cut it off from the dev server.
 */

type Device = { app: App; page: Page; context: BrowserContext };

/** The Worker's account outlives a run, so titles carry a random suffix. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

test.describe.configure({ mode: 'serial' });

async function device(browser: Browser): Promise<Device> {
	const { baseURL, timezoneId, viewport } = test.info().project.use;
	const context = await browser.newContext({ baseURL, timezoneId, viewport });
	await signInAccount(context);
	const page = await context.newPage();
	await page.clock.setFixedTime(NOW);
	await page.goto('/no-date');
	await expect(page.getByRole('heading', { name: 'No date' })).toBeVisible({ timeout: 30_000 });
	return { app: new App(page), page, context };
}

const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

const goOffline = ({ context }: Device) => context.route('**/api/sync', route => route.abort('internetdisconnected'));
const goOnline = ({ context }: Device) => context.unroute('**/api/sync');

const outbox = (page: Page) =>
	page.evaluate(() => {
		const raw = localStorage.getItem('procrastimate');
		const sync = raw ? (JSON.parse(raw) as { sync?: { outbox: unknown[]; reset?: boolean } }).sync : undefined;
		if (!sync) return -1;
		if (sync.reset) return -2;
		return sync.outbox.length;
	});

/** Waits until this install has a token and nothing left to upload. */
async function settled(device: Device) {
	await focus(device.page);
	await expect
		.poll(async () => {
			const token = await device.page.evaluate(() => localStorage.getItem('procrastimate-user'));
			if (!token) return false;
			return (await outbox(device.page)) === 0;
		})
		.toBe(true);
}

async function devices(browser: Browser): Promise<[Device, Device]> {
	const a = await device(browser);
	const b = await device(browser);
	await settled(a);
	await settled(b);
	return [a, b];
}

async function rename(app: App, from: string, to: string) {
	await app
		.row(from)
		.getByRole('button', { name: new RegExp(`^${from}`) })
		.click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.fill(to);
	await title.press('Enter');
	await app.details().getByRole('button', { name: 'Close' }).click();
}

test.afterEach(async ({ browser }) => {
	for (const context of browser.contexts()) await context.close();
});

test('a change on one device shows on the other', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const title = unique('Synced task');
	await a.app.add(title);
	await settled(a);
	await focus(b.page);
	await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });

	await b.app
		.row(title)
		.getByRole('checkbox', { name: `Complete ${title}` })
		.click();
	await expect(b.app.row(title)).toHaveCount(0);
	await settled(b);
	await focus(a.page);
	await expect(a.app.row(title)).toHaveCount(0, { timeout: 10_000 });
});

test('a change on one device shows on the other at once, without focus or the minute timer', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const title = unique('Nudged task');
	await a.app.add(title);
	await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });

	await b.app
		.row(title)
		.getByRole('checkbox', { name: `Complete ${title}` })
		.click();
	await expect(a.app.row(title)).toHaveCount(0, { timeout: 10_000 });
});

test('a stale tab in the same browser never saves over what another tab synced, and its edits still upload', async ({
	browser,
}) => {
	const [a] = await devices(browser);
	const stale = await a.context.newPage();
	await stale.clock.setFixedTime(NOW);
	await stale.route('**/api/sync', route => route.abort('internetdisconnected'));
	await stale.routeWebSocket('**/api/sync/socket', socket => socket.close());
	await stale.goto('/no-date');
	await expect(stale.getByRole('heading', { name: 'No date' })).toBeVisible();

	const synced = unique('Synced in the other tab');
	await a.app.add(synced);
	// Its own commit timer uploads it, so no timer is left to upload the stale tab's edit by chance.
	await expect.poll(() => outbox(a.page)).toBe(0);
	await new App(stale).add(unique('Added in the stale tab'));

	expect(await a.page.evaluate(() => localStorage.getItem('procrastimate'))).toContain(synced);
	await expect.poll(() => outbox(a.page), { timeout: 5_000 }).toBe(0);
});

test('changes made offline apply at once and upload when the network returns', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const kept = unique('Kept offline');
	const later = unique('Added offline');
	await a.app.add(kept);
	await settled(a);

	await goOffline(a);
	await a.app.add(later);
	await rename(a.app, kept, `${kept} renamed`);
	await expect(a.app.row(later)).toBeVisible();
	await expect.poll(() => outbox(a.page)).toBeGreaterThan(0);

	await a.page.reload();
	await expect(a.app.row(later)).toBeVisible();

	await goOnline(a);
	await settled(a);
	await focus(b.page);
	await expect(b.app.row(later)).toBeVisible({ timeout: 10_000 });
	await expect(b.app.row(`${kept} renamed`)).toBeVisible({ timeout: 10_000 });
});

test('typing notes shows each keystroke at once and queues one op with the last value', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const title = unique('Typed');
	await a.app.add(title);
	await settled(a);

	await goOffline(a);
	await a.app
		.row(title)
		.getByRole('button', { name: new RegExp(`^${title}`) })
		.click();
	const notes = a.app.details().getByRole('textbox', { name: 'Notes' });
	await notes.pressSequentially('Buy oat milk');
	await expect(notes).toHaveValue('Buy oat milk');
	await expect.poll(() => outbox(a.page)).toBe(1);

	await goOnline(a);
	await settled(a);
	await focus(b.page);
	await b.app
		.row(title)
		.getByRole('button', { name: new RegExp(`^${title}`) })
		.click();
	await expect(b.app.details().getByRole('textbox', { name: 'Notes' })).toHaveValue('Buy oat milk', {
		timeout: 10_000,
	});
});

test('both devices editing the same task offline converge', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const title = unique('Shared');
	await a.app.add(title);
	await settled(a);
	await focus(b.page);
	await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });

	await goOffline(a);
	await goOffline(b);
	await rename(a.app, title, `${title} from A`);
	await rename(b.app, title, `${title} from B`);
	await b.app
		.row(`${title} from B`)
		.getByRole('button', { name: new RegExp(`^${title}`) })
		.click();
	await b.app.details().getByRole('textbox', { name: 'Notes' }).fill('Notes from B');
	await b.app.details().getByRole('button', { name: 'Close' }).click();

	await goOnline(a);
	await settled(a);
	await goOnline(b);
	await settled(b);
	await settled(a);

	const rowA = a.app.list('Tasks without a date').getByRole('listitem').filter({ hasText: title });
	const rowB = b.app.list('Tasks without a date').getByRole('listitem').filter({ hasText: title });
	await expect(rowA).toHaveCount(1);
	await expect(rowA).toContainText('Notes from B');
	await expect(rowB).toHaveCount(1);
	const winner = await b.page.locator(`[data-task^="${title}"]`).getAttribute('data-task');
	expect([`${title} from A`, `${title} from B`]).toContain(winner);
	await expect(a.app.row(winner!)).toBeVisible();
});

test('delete all data clears this device and the other', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const title = unique('Before delete');
	await b.app.add(title);
	await settled(b);
	await focus(a.page);
	await expect(a.app.row(title)).toBeVisible({ timeout: 10_000 });

	await a.app.openSettings();
	await a.app.settings().getByRole('button', { name: 'Delete all data' }).click();
	await a.app.settings().getByRole('button', { name: 'Delete all data' }).click();
	await a.page.keyboard.press('Escape');
	await expect(a.app.row(title)).toHaveCount(0);
	await settled(a);
	await focus(b.page);
	await expect(b.app.row(title)).toHaveCount(0, { timeout: 10_000 });
	expect(await a.page.evaluate(() => localStorage.getItem('procrastimate-user'))).toBeTruthy();
});
