import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
	App,
	deviceContext,
	E2E_PASSWORD,
	e2eEmail,
	expect,
	goOffline as cut,
	goOnline as restore,
	NOW,
	signInAccount,
	test,
	unique,
} from './fixtures.ts';

/**
 * Two browser contexts are two devices on this test's account. Sync starts on its own and streams every change,
 * locally within a few hundred milliseconds; the waits allow ten seconds for a machine busy with other agents.
 * Offline cuts the context's network and refuses the sync routes, so PowerSync's stream drops and its uploads fail
 * until the network returns. Each test has its own account, so titles only need to be unique inside the test.
 */

type Device = { app: App; page: Page; context: BrowserContext };

test.describe.configure({ mode: 'serial' });

async function device(browser: Browser): Promise<Device> {
	const context = await deviceContext(browser);
	await signInAccount(context);
	const page = await context.newPage();
	await page.clock.setFixedTime(NOW);
	await page.goto('/no-date');
	await expect(page.getByRole('heading', { name: 'No date' })).toBeVisible({ timeout: 30_000 });
	return { app: new App(page), page, context };
}

const goOffline = ({ context }: Device) => cut(context);
const goOnline = ({ context }: Device) => restore(context);

/** Waits until every write this device made is on the server. */
const settled = ({ app }: Device) => expect.poll(() => app.pending(), { timeout: 15_000 }).toBe(0);

async function devices(browser: Browser): Promise<[Device, Device]> {
	return [await device(browser), await device(browser)];
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

test('a change on one device shows on the other at once, both ways', async ({ browser }) => {
	const [a, b] = await devices(browser);
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

test('two tabs of one browser share one database, and both upload', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const other = await a.context.newPage();
	await other.clock.setFixedTime(NOW);
	await other.goto('/no-date');
	const tab = new App(other);

	const first = unique('Added in the first tab');
	await a.app.add(first);
	await expect(tab.row(first)).toBeVisible({ timeout: 10_000 });
	const second = unique('Added in the second tab');
	await tab.add(second);
	await expect(a.app.row(second)).toBeVisible({ timeout: 10_000 });
	await expect(b.app.row(first)).toBeVisible({ timeout: 10_000 });
	await expect(b.app.row(second)).toBeVisible({ timeout: 10_000 });
});

test('changes made offline apply at once, survive a reload, and upload when the network returns', async ({
	browser,
}) => {
	const [a, b] = await devices(browser);
	const kept = unique('Kept offline');
	const later = unique('Added offline');
	await a.app.add(kept);
	await expect(b.app.row(kept)).toBeVisible({ timeout: 10_000 });

	await goOffline(a);
	await a.app.add(later);
	await rename(a.app, kept, `${kept} renamed`);
	await expect(a.app.row(later)).toBeVisible();
	await expect.poll(() => a.app.pending()).toBeGreaterThan(0);

	// The page itself has to load, so only the sync routes stay refused.
	await a.context.setOffline(false);
	await a.page.reload();
	await expect(a.app.row(later)).toBeVisible();
	await expect(a.app.row(`${kept} renamed`)).toBeVisible();
	await expect(b.app.row(later)).toHaveCount(0);

	await goOnline(a);
	await expect(b.app.row(later)).toBeVisible({ timeout: 15_000 });
	await expect(b.app.row(`${kept} renamed`)).toBeVisible();
});

test('a task added the moment before the page goes away is there after the reload', async ({ browser }) => {
	const [a, b] = await devices(browser);
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
});

test('an edit the server rejects goes back to the server value with a notice, and the device keeps syncing', async ({
	browser,
}) => {
	const [a, b] = await devices(browser);
	const title = unique('Guarded');
	await a.app.add(title);
	await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });

	const refused = `${title} refused`;
	// Stands in for a write only a client bug could build: it reaches the server with a priority the schema refuses.
	await a.context.route('**/api/upload', async route => {
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
	await a.context.unroute('**/api/upload');

	const next = unique('After the rejection');
	await a.app.add(next);
	await expect(b.app.row(next)).toBeVisible({ timeout: 10_000 });
	await expect(b.app.row(title)).toBeVisible();
	await expect(b.app.row(refused)).toHaveCount(0);
});

test('typing notes shows each keystroke at once and uploads one write with the last value', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const title = unique('Typed');
	await a.app.add(title);
	await settled(a);
	const id = await a.app.taskId(title);

	await goOffline(a);
	await a.app
		.row(title)
		.getByRole('button', { name: new RegExp(`^${title}`) })
		.click();
	const notes = a.app.details().getByRole('textbox', { name: 'Notes' });
	await notes.pressSequentially('Buy oat milk');
	await expect(notes).toHaveValue('Buy oat milk');
	await expect.poll(() => a.app.pending()).toBeGreaterThan(1);

	const writes: { id: string; values?: Record<string, unknown> }[] = [];
	a.page.on('request', request => {
		if (request.url().endsWith('/api/upload')) writes.push(...(request.postDataJSON() as { writes: [] }).writes);
	});
	await goOnline(a);
	await settled(a);
	expect(writes.filter(write => write.id === id)).toEqual([
		{ op: 'patch', table: 'tasks', id, values: { notes: 'Buy oat milk' } },
	]);
	await b.app
		.row(title)
		.getByRole('button', { name: new RegExp(`^${title}`) })
		.click();
	await expect(b.app.details().getByRole('textbox', { name: 'Notes' })).toHaveValue('Buy oat milk', {
		timeout: 10_000,
	});
});

test('both devices editing the same task offline converge, each field to the last write', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const title = unique('Shared');
	await a.app.add(title);
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

	const rowA = a.app.list('Tasks without a date').getByRole('listitem').filter({ hasText: title });
	const rowB = b.app.list('Tasks without a date').getByRole('listitem').filter({ hasText: title });
	await expect(rowA).toHaveCount(1);
	await expect(rowA).toContainText('Notes from B', { timeout: 10_000 });
	await expect(rowB).toHaveCount(1);
	await expect(a.app.row(`${title} from B`)).toBeVisible({ timeout: 10_000 });
	await expect(b.app.row(`${title} from B`)).toBeVisible();
});

test('a delete beats an edit that reaches the server after it', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const title = unique('Doomed');
	await a.app.add(title);
	await expect(b.app.row(title)).toBeVisible({ timeout: 10_000 });

	await goOffline(b);
	await rename(b.app, title, `${title} edited late`);
	await a.app
		.row(title)
		.getByRole('button', { name: new RegExp(`^${title}`) })
		.click();
	await a.app.details().getByRole('button', { name: 'Delete task' }).click();
	await expect(a.app.row(title)).toHaveCount(0);
	await settled(a);

	await goOnline(b);
	await settled(b);
	await expect(b.app.row(`${title} edited late`)).toHaveCount(0, { timeout: 10_000 });
	await expect(a.app.row(`${title} edited late`)).toHaveCount(0);
});

test('delete all data clears this device and the other', async ({ browser }) => {
	const [a, b] = await devices(browser);
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

test('subtasks turned into tasks show as tasks on the other device, and undo nests them again', async ({ browser }) => {
	const [a, b] = await devices(browser);
	const parent = unique('Pack');
	await a.app.add(parent);
	await a.app
		.row(parent)
		.getByRole('button', { name: new RegExp(`^${parent}`) })
		.click();
	const subtask = a.app.details().getByRole('textbox', { name: 'Add subtask' });
	for (const title of ['Passport', 'Charger']) {
		await subtask.fill(title);
		await subtask.press('Enter');
	}
	await a.app.details().getByRole('button', { name: 'Subtask actions' }).click();
	await a.page.getByRole('button', { name: `Start with “${parent}:”` }).click();
	await expect(
		a.app
			.details()
			.getByRole('list', { name: `Subtasks of ${parent}` })
			.getByRole('listitem'),
	).toHaveCount(0);
	await a.app.details().getByRole('button', { name: 'Close' }).click();
	await expect(a.app.row(`${parent}: Passport`)).toBeVisible();

	await expect(b.app.row(`${parent}: Passport`)).toBeVisible({ timeout: 10_000 });
	await expect(b.app.row(`${parent}: Charger`)).toBeVisible();
	await expect(b.app.row(parent)).toBeVisible();

	await a.page.getByRole('button', { name: 'Undo' }).click();
	await expect(a.app.row(`${parent}: Passport`)).toHaveCount(0);
	await expect(a.app.row(parent).getByRole('img', { name: '0 of 2 subtasks done' })).toBeVisible();
	await expect(b.app.row(`${parent}: Passport`)).toHaveCount(0, { timeout: 10_000 });
	await expect(b.app.row(parent).getByRole('img', { name: '0 of 2 subtasks done' })).toBeVisible();
});

test('signing out keeps this device’s data, and signing in as someone else starts from an empty list', async ({
	browser,
}) => {
	const [a, b] = await devices(browser);
	const title = unique('Mine only');
	await a.app.add(title);
	await settled(a);
	const signOut = async () => {
		await a.app.openSettings();
		await a.app.settings().getByRole('button', { name: 'Sign out' }).click();
		await expect(a.page.getByRole('form', { name: 'Sign in' })).toBeVisible();
	};
	const signIn = async (email: string, create: boolean) => {
		if (create) await a.page.getByRole('button', { name: 'Create an account' }).click();
		await a.page.getByLabel('Email').fill(email);
		await a.page.getByLabel('Password').fill(E2E_PASSWORD);
		await a.page.getByRole('button', { name: create ? 'Create account' : 'Sign in', exact: true }).click();
		await expect(a.page.getByRole('form', { name: 'Sign in' })).toBeHidden();
	};

	// Signing back in with the sync routes refused shows what stayed in this browser.
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
	await expect(a.page.getByRole('heading', { name: 'No date' })).toBeVisible();
	await expect(a.app.row(title)).toHaveCount(0);
	const other = unique('Theirs');
	await a.app.add(other);
	await settled(a);
	await expect(b.app.row(other)).toHaveCount(0);

	await signOut();
	await signIn(e2eEmail(), false);
	await a.page.goto('/no-date');
	await expect(a.app.row(title)).toBeVisible({ timeout: 10_000 });
	await expect(a.app.row(other)).toHaveCount(0);
});
