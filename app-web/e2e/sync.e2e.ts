import { strToU8, zipSync } from 'fflate';
import {
	BOOT_TIMEOUT,
	App,
	type Device,
	deviceContext,
	signInAccount,
	E2E_PASSWORD,
	e2eEmail,
	expect,
	goOffline as cut,
	goOnline as restore,
	NOW,
	onlineRefusingSync,
	test,
	unique,
} from './fixtures.ts';

/**
 * Sync streams locally within a few hundred milliseconds; the waits allow ten seconds for a machine busy with other
 * agents.
 */

test.describe.configure({ mode: 'serial' });

const goOffline = ({ context }: Device) => cut(context);
const goOnline = ({ context }: Device) => restore(context);

const settled = ({ app }: Device) => expect.poll(() => app.pending(), { timeout: 15_000 }).toBe(0);

async function signOutOf({ app, page }: Device) {
	await app.openSettings();
	await app.settings().getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
}

async function signInTo({ page }: Device, email: string, create: boolean) {
	if (create) await page.getByRole('button', { name: 'Create an account' }).click();
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(E2E_PASSWORD);
	await page.getByRole('button', { name: create ? 'Create account' : 'Sign in', exact: true }).click();
	await expect(page.getByRole('form', { name: 'Sign in' })).toBeHidden();
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

test('a change on one device shows on the other at once, both ways', { tag: '@webkit' }, async ({ devices }) => {
	const [a, b] = [await devices.open(), await devices.open()];
	const title = unique('Synced task');
	await a.app.add(title);
	await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });

	await b.app
		.row(title)
		.getByRole('checkbox', { name: `Complete ${title}` })
		.click();
	await expect(b.app.row(title)).toHaveCount(0);
	await expect(a.app.row(title)).toHaveCount(0, { timeout: 10_000 });
});

test(
	'two tabs of one browser share one database, both upload, and follow a switch to another account',
	{ tag: '@webkit' },
	async ({ devices }) => {
		const [a, b] = [await devices.open(), await devices.open()];
		const other = await a.context.newPage();
		// WebKit's persistent contexts install the clock only in a page that has loaded a document.
		await other.goto('/no-date');
		await other.clock.setFixedTime(NOW);
		const tab = new App(other);

		const first = unique('Added in the first tab');
		await a.app.add(first);
		await expect(tab.row(first)).toBeVisible({ timeout: 10_000 });
		const second = unique('Added in the second tab');
		await tab.add(second);
		await expect(a.app.row(second)).toBeVisible({ timeout: 10_000 });
		await expect(b.app.row(first)).toBeVisible({ timeout: 10_000 });
		await expect(b.app.row(second)).toBeVisible({ timeout: 10_000 });

		await settled(a);
		await signOutOf(a);
		await signInTo(a, `other-${crypto.randomUUID().slice(0, 8)}@procrastimate.test`, true);
		await a.page.goto('/no-date');
		await expect(a.app.row(first)).toHaveCount(0);
		await expect(tab.row(first)).toHaveCount(0, { timeout: 10_000 });
		const theirs = unique('After the switch');
		await a.app.add(theirs);
		await expect(tab.row(theirs)).toBeVisible({ timeout: 10_000 });
	},
);

test(
	'changes made offline apply at once with a cloud on the row, survive a reload, and upload when the network returns',
	{ tag: '@webkit' },
	async ({ devices }) => {
		const [a, b] = [await devices.open(), await devices.open()];
		const kept = unique('Kept offline');
		const later = unique('Added offline');
		await a.app.add(kept);
		await expect(b.app.row(kept)).toBeVisible({ timeout: 10_000 });

		await goOffline(a);
		await a.app.add(later);
		await rename(a.app, kept, `${kept} renamed`);
		await expect(a.app.row(later)).toBeVisible();
		await expect.poll(() => a.app.pending()).toBeGreaterThan(0);
		const unsynced = (name: string) => a.app.row(name).getByRole('img', { name: 'Not synced yet' });
		await expect(unsynced(later)).toBeVisible({ timeout: 1000 });
		await a.app
			.row(later)
			.getByRole('button', { name: new RegExp(`^${later}`) })
			.click();
		await expect(
			a.app.details().getByRole('status').filter({ hasText: 'Not saved yet. Will sync when online.' }),
		).toBeVisible();
		await a.app.details().getByRole('button', { name: 'Close' }).click();

		// The page itself has to load, so only the sync routes stay refused.
		await onlineRefusingSync(a.context);
		await a.app.reload();
		await expect(a.app.row(later)).toBeVisible();
		await expect(a.app.row(`${kept} renamed`)).toBeVisible();
		await expect(b.app.row(later)).toHaveCount(0);

		await goOnline(a);
		await expect(b.app.row(later)).toBeVisible({ timeout: 15_000 });
		await expect(b.app.row(`${kept} renamed`)).toBeVisible();
		await expect(unsynced(later)).toHaveCount(0, { timeout: 15_000 });
	},
);

test(
	'a task added the moment before the page goes away is there after the reload',
	{ tag: '@webkit' },
	async ({ devices }) => {
		const [a, b] = [await devices.open(), await devices.open()];
		const title = unique('Saved in time');
		await a.app.openQuickAdd();
		await a.app.taskInput().fill(title);
		// The command and the reload run in one task, so the local database cannot have written it yet.
		await a.page.evaluate(() => {
			const input = document.querySelector<HTMLElement>('[aria-label="Task name"]')!;
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			location.reload();
		});
		await expect(a.page.getByRole('heading', { name: 'No date' })).toBeVisible();
		await expect(a.app.row(title)).toBeVisible();
		await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });
	},
);

test('an edit the server rejects goes back to the server value with a notice, and the device keeps syncing', async ({
	devices,
}) => {
	const [a, b] = [await devices.open(), await devices.open()];
	const title = unique('Guarded');
	await a.app.add(title);
	await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });

	const refused = `${title} refused`;
	// Stands in for a write only a client bug could build: it reaches the server with a priority the schema refuses.
	await a.context.route('**/api/sync', async route => {
		const body = route.request().postDataJSON() as { writes: { values?: Record<string, unknown> }[] };
		for (const write of body.writes) if (write.values?.title === refused) write.values.priority = 99;
		await route.continue({ postData: JSON.stringify(body) });
	});
	await rename(a.app, title, refused);
	await expect(a.page.getByRole('status').filter({ hasText: `Couldn’t save a change to “${refused}”` })).toBeVisible({
		timeout: 10_000,
	});
	await expect(a.app.row(title)).toBeVisible({ timeout: 10_000 });
	await expect(a.app.row(refused)).toHaveCount(0);
	await a.context.unroute('**/api/sync');

	const next = unique('After the rejection');
	await a.app.add(next);
	await expect(b.app.row(next)).toBeVisible({ timeout: 10_000 });
	await expect(b.app.row(title)).toBeVisible();
	await expect(b.app.row(refused)).toHaveCount(0);
});

test('delete all data clears this device and the other', async ({ devices }) => {
	const [a, b] = [await devices.open(), await devices.open()];
	const title = unique('Before delete');
	await b.app.add(title);
	await expect(a.app.row(title)).toBeVisible({ timeout: 10_000 });

	await a.app.openSettings();
	await a.app.settings().getByRole('button', { name: 'Delete all data' }).click();
	await a.app.settings().getByRole('button', { name: 'Delete all data' }).click();
	await a.page.keyboard.press('Escape');
	await expect(a.app.row(title)).toHaveCount(0);
	await expect(b.app.row(title)).toHaveCount(0, { timeout: 10_000 });
	expect(await a.page.evaluate(() => localStorage.getItem('procrastimate-user'))).toBeTruthy();
});

test(
	'signing out keeps this device’s data, and signing in as someone else starts from an empty list',
	{ tag: '@webkit' },
	async ({ devices }) => {
		const [a, b] = [await devices.open(), await devices.open()];
		const title = unique('Mine only');
		await a.app.add(title);
		await settled(a);
		const signOut = () => signOutOf(a);
		const signIn = (email: string, create: boolean) => signInTo(a, email, create);

		await signOut();
		await goOffline(a);
		await a.context.setOffline(false);
		await signIn(e2eEmail(), false);
		await a.page.goto('/no-date');
		await expect(a.app.row(title)).toBeVisible();
		await goOnline(a);

		await signOut();
		await signIn(`other-${crypto.randomUUID().slice(0, 8)}@procrastimate.test`, true);
		await a.page.goto('/no-date');
		await expect(a.page.getByRole('heading', { name: 'No date' })).toBeVisible({ timeout: BOOT_TIMEOUT });
		await expect(a.app.row(title)).toHaveCount(0);
		const other = unique('Theirs');
		await a.app.add(other);
		await settled(a);
		await expect(b.app.row(other)).toHaveCount(0);

		await signOut();
		await signIn(e2eEmail(), false);
		await a.page.goto('/no-date');
		await expect(a.app.row(title)).toBeVisible({ timeout: BOOT_TIMEOUT });
		await expect(a.app.row(other)).toHaveCount(0);
	},
);

test('a new device holds its settings changes until the account’s settings arrive, then writes only those', async ({
	browser,
	devices,
}) => {
	const a = await devices.open();
	await a.app.openSettings();
	await a.app.dictationOption('ElevenLabs').click();
	await expect(a.app.dictationOption('ElevenLabs')).toHaveAttribute('aria-checked', 'true');
	await settled(a);

	// A fresh browser profile in another zone, whose first read finds no settings row because sync cannot reach the
	// server yet. It notes its zone and pins a button before the row arrives. The token route stays open, since it is
	// also the session check that opens the app.
	const context = await deviceContext(browser, { timezoneId: 'Europe/Berlin' });
	await signInAccount(context);
	const stream = /\/api\/(sync|live)$/;
	await context.route(stream, route => route.abort('internetdisconnected'));
	const page = await context.newPage();
	await page.clock.setFixedTime(NOW);
	await page.goto('/no-date');
	await expect(page.getByRole('heading', { name: 'No date' })).toBeVisible({ timeout: 30_000 });
	const b: Device = { app: new App(page), page, context, email: '', name: 'E2E' };
	await b.app.openSettings();
	const labels = (app: App) =>
		app.settings().getByRole('group', { name: 'Quick add buttons' }).getByRole('button').filter({ hasText: 'Labels' });
	await labels(b.app).click();
	await expect(labels(b.app)).toHaveAttribute('aria-pressed', 'true');

	await context.unroute(stream);
	await expect(b.app.dictationOption('ElevenLabs')).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
	await expect(labels(b.app)).toHaveAttribute('aria-pressed', 'true');
	await settled(b);
	await expect(labels(a.app)).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
	await expect(a.app.dictationOption('ElevenLabs')).toHaveAttribute('aria-checked', 'true');
	expect(await a.page.evaluate(() => window.procrastimate.entity('settings', 'settings'))).toMatchObject({
		timeZone: 'Europe/Berlin',
		dictation: 'elevenlabs',
	});
});

function refuseClears() {
	const clear = IDBObjectStore.prototype.clear;
	IDBObjectStore.prototype.clear = function (this: IDBObjectStore) {
		if (!sessionStorage.getItem('e2e-refuse-clear')) return clear.call(this);
		if (this.name === 'bytes')
			sessionStorage.setItem('e2e-clear-tries', String(Number(sessionStorage.getItem('e2e-clear-tries')) + 1));
		throw new DOMException('Refused', 'UnknownError');
	};
}

test('this browser belongs to a new account only once the previous one’s rows are gone, and a refused clear is tried again', async ({
	devices,
}) => {
	const a = await devices.open();
	const title = unique('First account’s');
	await a.app.add(title);
	await settled(a);
	const owner = () => a.page.evaluate(() => localStorage.getItem('procrastimate-owner'));
	const tries = () => a.page.evaluate(() => Number(sessionStorage.getItem('e2e-clear-tries')));
	const first = await owner();
	expect(first).toBeTruthy();
	await a.context.addInitScript(refuseClears);
	await a.page.evaluate(refuseClears);
	await a.page.evaluate(() => sessionStorage.setItem('e2e-refuse-clear', '1'));

	await signOutOf(a);
	await signInTo(a, `other-${crypto.randomUUID().slice(0, 8)}@procrastimate.test`, true);
	await expect.poll(tries, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
	expect(await owner()).toBe(first);

	await a.page.evaluate(() => sessionStorage.setItem('e2e-clear-tries', '0'));
	await a.page.goto('/no-date');
	await expect.poll(tries, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
	expect(await owner()).toBe(first);
	await expect(a.app.row(title)).toHaveCount(0);

	await a.page.evaluate(() => sessionStorage.removeItem('e2e-refuse-clear'));
	await expect(a.page.getByRole('heading', { name: 'No date' })).toBeVisible({ timeout: 15_000 });
	expect(await owner()).toBe(await a.page.evaluate(() => localStorage.getItem('procrastimate-user')));
	expect(await owner()).not.toBe(first);
	await expect(a.app.row(title)).toHaveCount(0);
});

test('a switch whose clear the browser lost still clears before the next account reads', async ({
	browser,
	devices,
}) => {
	const a = await devices.open();
	const title = unique('Previous account’s');
	await a.app.add(title);
	await settled(a);
	await signOutOf(a);
	const origin = new URL(a.page.url()).origin;
	const email = `other-${crypto.randomUUID().slice(0, 8)}@procrastimate.test`;
	const outside = await browser.newContext();
	const created = await outside.request.post(`${origin}/api/auth/sign-up/email`, {
		headers: { origin },
		data: { email, password: E2E_PASSWORD, name: 'Other' },
	});
	const { user } = (await created.json()) as { user: { id: string } };
	await outside.close();
	// What a page closed right after a switch can leave: the browser kept `localStorage`, which already names the new
	// account, and dropped the database's last commits, the clear among them.
	await a.page.evaluate(id => localStorage.setItem('procrastimate-owner', id), user.id);
	// Without sync, since the new account's first checkpoint would drop the other account's rows anyway.
	await a.context.route('**/api/sync/token', route => route.abort());

	await signInTo(a, email, false);
	await a.page.goto('/no-date');
	await expect.poll(() => a.page.evaluate(() => window.procrastimate?.reads().reloads ?? 0)).toBeGreaterThan(0);
	expect(await a.page.evaluate(t => window.procrastimate.taskId(t), title)).toBeUndefined();
	await expect(a.app.row(title)).toHaveCount(0);
});

function refuseDatabase() {
	if (!sessionStorage.getItem('e2e-no-database')) return;
	const refuse = function () {
		throw new DOMException('Refused', 'SecurityError');
	};
	Object.defineProperty(window, 'SharedWorker', { value: refuse });
	Object.defineProperty(window, 'Worker', { value: refuse });
}

test('a database that cannot open says so, and an edit it could not write is written at the next launch', async ({
	devices,
}) => {
	const [a, b] = [await devices.open(), await devices.open()];
	await a.context.addInitScript(refuseDatabase);
	const title = unique('Kept for later');
	await a.app.openQuickAdd();
	await a.app.taskInput().fill(title);
	// The command and the reload run in one task, so only the copy holds it when the reloaded page cannot write it.
	await a.page.evaluate(() => {
		sessionStorage.setItem('e2e-no-database', '1');
		const input = document.querySelector<HTMLElement>('[aria-label="Task name"]')!;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		location.reload();
	});
	const alert = a.page.getByRole('alert').filter({ hasText: 'Couldn’t open your tasks' });
	await expect(alert).toBeVisible({ timeout: 15_000 });
	await expect(a.page.getByRole('heading', { name: 'No date' })).toHaveCount(0);

	await a.page.evaluate(() => sessionStorage.removeItem('e2e-no-database'));
	await alert.getByRole('button', { name: 'Reload' }).click();
	await expect(a.page.getByRole('heading', { name: 'No date' })).toBeVisible();
	await expect(a.app.row(title)).toBeVisible();
	await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });
});

function backupOf(count: number) {
	const rows = Array.from({ length: count }, (_, i) => `task,Imported ${i + 1},,,4,1,,,,,,,,,,,,,`);
	const csv = `\uFEFFTYPE,CONTENT,DESCRIPTION,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE,REMINDER_DATE_LANG\r\n${rows.join('\r\n')}\r\n`;
	return {
		name: 'todoist-backup.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from(zipSync({ 'Big [1].csv': strToU8(csv) })),
	};
}

test('one command’s writes upload in one request, and an edit reads back only the row it changed, on this device and the other', async ({
	devices,
}) => {
	const [a, b] = [await devices.open(), await devices.open()];
	await settled(a);
	await goOffline(a);
	await a.app.openSettings();
	const chooser = a.page.waitForEvent('filechooser');
	await a.app.settings().getByRole('button', { name: 'Import from Todoist' }).click();
	await (await chooser).setFiles(backupOf(150));
	await expect(a.app.importSummary()).toContainText('150 tasks');
	await a.page.keyboard.press('Escape');
	const uploads: number[] = [];
	a.context.on('request', request => {
		if (!request.url().endsWith('/api/sync')) return;
		const { writes } = request.postDataJSON() as { writes: [] };
		if (writes.length) uploads.push(writes.length);
	});
	await goOnline(a);
	await settled(a);
	// The outbox goes whole in one request, and a retried request carries the same writes again.
	expect(new Set(uploads)).toEqual(new Set([151]));
	const has = (device: Device, title: string) =>
		expect.poll(() => device.page.evaluate(t => window.procrastimate.taskId(t) !== undefined, title), {
			timeout: 10_000,
		});
	await has(b, 'Imported 150').toBe(true);
	// The import's own rows stream back to this device too, once the server stamps who made them, and a copy that
	// landed after the count below read as the edit's: 153 rows.
	await expect
		.poll(
			() =>
				a.page.evaluate(
					() =>
						Array.from({ length: 150 }, (_, i) => window.procrastimate.taskId(`Imported ${i + 1}`)).filter(
							id => !id || !(window.procrastimate.entity('task', id) as { createdBy: string | null }).createdBy,
						).length,
				),
			{ timeout: 15_000 },
		)
		.toBe(0);
	await a.app.openNavigation();
	await a.app.nav('Big').click();
	await expect(a.app.row('Imported 1')).toBeVisible();
	const rowsRead = ({ page }: Device) => page.evaluate(() => window.procrastimate.reads().rows);
	const [before, beforeOther] = [await rowsRead(a), await rowsRead(b)];

	const title = unique('Renamed');
	await rename(a.app, 'Imported 1', title);
	await settled(a);
	await has(b, title).toBe(true);
	// This device reads its own write back, and the server's copy of it once it streams down.
	await expect.poll(async () => (await rowsRead(a)) - before).toBeGreaterThan(0);
	expect((await rowsRead(a)) - before).toBeLessThanOrEqual(2);
	expect((await rowsRead(b)) - beforeOther).toBe(1);
});
