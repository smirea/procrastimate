import type { Browser, BrowserContext, Page } from '@playwright/test';
import { App, E2E_PASSWORD, expect, NOW, test, unique } from './fixtures.ts';

/**
 * Two people, each with their own account in their own browser context. The owner shares a project with the
 * guest's email; a public link opens read only for a visitor who never signed in.
 */

type Person = { app: App; page: Page; context: BrowserContext; email: string; name: string };

test.describe.configure({ mode: 'serial' });

async function newContext(browser: Browser) {
	const { baseURL, timezoneId, viewport } = test.info().project.use;
	return browser.newContext({ baseURL, timezoneId, viewport });
}

async function person(browser: Browser, name: string): Promise<Person> {
	const context = await newContext(browser);
	const email = `e2e-${crypto.randomUUID()}@procrastimate.test`;
	const signUp = await context.request.post('/api/auth/sign-up/email', {
		data: { email, password: E2E_PASSWORD, name },
	});
	expect(signUp.ok(), await signUp.text()).toBe(true);
	const page = await context.newPage();
	await page.clock.setFixedTime(NOW);
	await page.goto('/inbox');
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 30_000 });
	return { app: new App(page), page, context, email, name };
}

const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const shareSheet = (page: Page) => page.getByRole('dialog', { name: 'Share' });

async function ownerWithProject(browser: Browser) {
	const owner = await person(browser, 'Olive');
	const project = unique('Groceries');
	const task = unique('Buy milk');
	await owner.app.createProject(project);
	await owner.app.add(task);
	await expect(owner.app.row(task)).toBeVisible();
	return { owner, project, task };
}

test.afterEach(async ({ browser }) => {
	for (const context of browser.contexts()) await context.close();
});

test('a guest completes a task in a project shared with them, and the owner sees who did it', async ({ browser }) => {
	const guest = await person(browser, 'Gus');
	const { owner, project, task } = await ownerWithProject(browser);

	await owner.page.getByRole('button', { name: 'Share project' }).click();
	await shareSheet(owner.page).getByRole('textbox', { name: 'Email or name' }).fill(guest.email);
	// The row shows before the server has the share, so wait for the share itself before the guest looks.
	const created = owner.page.waitForResponse(r => r.url().includes('/api/shares') && r.request().method() === 'POST');
	await shareSheet(owner.page).getByRole('list', { name: 'People found' }).getByRole('button', { name: /Gus/ }).click();
	await expect(shareSheet(owner.page).getByRole('region', { name: 'People with access' })).toContainText('Gus');
	expect((await created).ok()).toBe(true);
	await owner.page.keyboard.press('Escape');

	// The guest's tab learned its spaces at launch, before the share existed, so a reload is the launch that sees it.
	await guest.page.reload();
	const shared = sidebar(guest.page).getByRole('region', { name: 'Shared with me' });
	await expect(shared.getByRole('link', { name: new RegExp(project) })).toBeVisible({ timeout: 15_000 });
	await expect(shared).toContainText('Olive');
	await shared.getByRole('link', { name: new RegExp(project) }).click();
	await expect(guest.page.getByRole('heading', { level: 1, name: project })).toBeVisible();
	await expect(guest.page.getByText('Shared by Olive')).toBeVisible();
	await guest.app
		.row(task)
		.getByRole('button', { name: new RegExp(`^${task}`) })
		.click();
	await guest.app.details().getByRole('textbox', { name: 'Notes' }).pressSequentially('Two litres, oat');
	await guest.app.details().getByRole('button', { name: 'Close' }).click();
	await guest.app
		.row(task)
		.getByRole('checkbox', { name: `Complete ${task}` })
		.click();
	await expect(guest.app.row(task)).toHaveCount(0);

	await focus(owner.page);
	await expect(owner.app.row(task)).toHaveCount(0, { timeout: 15_000 });
	await owner.page.keyboard.press('/');
	await owner.page.getByRole('combobox', { name: 'Search' }).fill(task);
	await owner.page.getByRole('option', { name: new RegExp(task) }).click();
	const details = owner.app.details();
	await expect(details.getByText(/Completed by\s*Gus/)).toBeVisible();
	// Typed key by key; however many ops that syncs as, the activity reads one edit.
	const activity = details.getByRole('region', { name: 'Activity' });
	await expect(activity.getByRole('listitem')).toHaveText([
		/Gus\s*completed it/,
		/Gus\s*added notes/,
		/You\s*added this task/,
	]);
	await owner.page.keyboard.press('Escape');

	await sidebar(owner.page)
		.getByRole('link', { name: new RegExp(project) })
		.click();
	await owner.page.getByRole('button', { name: 'Show completed' }).click();
	const completed = owner.page
		.getByRole('list', { name: `Completed ${project} tasks` })
		.locator(`[data-task="${task}"]`);
	await expect(completed.getByLabel('Completed by Gus')).toBeVisible();
	await completed.getByRole('checkbox', { name: `Reopen ${task}` }).click();
	await expect(
		owner.page.getByRole('list', { name: `${project} tasks` }).locator(`[data-task="${task}"]`),
	).toBeVisible();
});

test('a guest who can only view a shared project gets no add row, and quick add there starts in Inbox', async ({
	browser,
}) => {
	const guest = await person(browser, 'Vera');
	const { owner, project, task } = await ownerWithProject(browser);

	await owner.page.getByRole('button', { name: 'Share project' }).click();
	await shareSheet(owner.page).getByRole('radio', { name: 'Can view' }).click();
	await shareSheet(owner.page).getByRole('textbox', { name: 'Email or name' }).fill(guest.email);
	const created = owner.page.waitForResponse(r => r.url().includes('/api/shares') && r.request().method() === 'POST');
	await shareSheet(owner.page)
		.getByRole('list', { name: 'People found' })
		.getByRole('button', { name: /Vera/ })
		.click();
	expect((await created).ok()).toBe(true);
	await owner.page.keyboard.press('Escape');

	await guest.page.reload();
	const shared = sidebar(guest.page).getByRole('region', { name: 'Shared with me' });
	await shared.getByRole('link', { name: new RegExp(project) }).click({ timeout: 15_000 });
	await expect(guest.app.row(task)).toBeVisible();
	await expect(guest.page.getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0);

	await guest.app.openQuickAdd();
	await expect(guest.app.quickAdd().getByText(project)).toHaveCount(0);
	await expect(guest.app.quickAdd().getByText('Inbox')).toBeVisible();
	await guest.page.screenshot({ path: 'test-results/sharing/view-only-quick-add.png' });
});

test('a guest comments on a shared task, and the owner sees it unread until they open it', async ({ browser }) => {
	const guest = await person(browser, 'Gus');
	const { owner, project, task } = await ownerWithProject(browser);
	await owner.page.getByRole('button', { name: 'Share project' }).click();
	await shareSheet(owner.page).getByRole('textbox', { name: 'Email or name' }).fill(guest.email);
	const created = owner.page.waitForResponse(r => r.url().includes('/api/shares') && r.request().method() === 'POST');
	await shareSheet(owner.page).getByRole('list', { name: 'People found' }).getByRole('button', { name: /Gus/ }).click();
	await expect(shareSheet(owner.page).getByRole('region', { name: 'People with access' })).toContainText('Gus');
	expect((await created).ok()).toBe(true);
	await owner.page.keyboard.press('Escape');

	await guest.page.reload();
	const shared = sidebar(guest.page).getByRole('region', { name: 'Shared with me' });
	await shared.getByRole('link', { name: new RegExp(project) }).click({ timeout: 15_000 });
	await guest.app.row(task).getByRole('button', { name: task, exact: true }).click();
	const composer = guest.app.details().getByRole('textbox', { name: 'Add a comment' });
	await composer.fill('Oat milk? https://example.com/oat');
	await composer.press('Enter');
	const posted = guest.app.details().getByRole('list', { name: 'Comment list' });
	await expect(posted).toContainText(/You\s*just now/);
	await expect(posted.getByRole('link', { name: 'https://example.com/oat' })).toBeVisible();
	await guest.page.keyboard.press('Escape');
	await expect(guest.app.row(task).locator('[data-comments="read"]')).toHaveText('1');

	const unread = owner.app.row(task).locator('[data-comments="unread"]');
	await expect(unread).toHaveText('1', { timeout: 15_000 });
	await expect(unread).toHaveAccessibleName('1 unread of 1 comments');
	await owner.app.row(task).getByRole('button', { name: task, exact: true }).click();
	const list = owner.app.details().getByRole('list', { name: 'Comment list' });
	await expect(list).toContainText('Gus');
	await expect(list).toContainText('Oat milk?');
	await expect(owner.app.details().getByRole('region', { name: 'Activity' }).getByRole('listitem').first()).toHaveText(
		/Gus\s*commented “Oat milk\? https:\/\/example\.com\/oat”/,
	);
	await owner.page.keyboard.press('Escape');
	await expect(owner.app.row(task).locator('[data-comments="read"]')).toHaveText('1');
	await expect(owner.app.row(task).locator('[data-comments="unread"]')).toHaveCount(0);
});
test('a public link opens read only for someone who is not signed in', async ({ browser }) => {
	const { owner, project, task } = await ownerWithProject(browser);

	await owner.page.getByRole('button', { name: 'Share project' }).click();
	await shareSheet(owner.page).getByRole('button', { name: 'Copy link' }).click();
	const link = shareSheet(owner.page).getByLabel('Link');
	await expect(link).toHaveText(/\/s\/.+/);
	const url = new URL((await link.textContent())!);

	const visitor = await newContext(browser);
	const page = await visitor.newPage();
	await page.goto(url.pathname);
	await expect(page.getByRole('heading', { level: 1, name: project })).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText(/Shared by\s*Olive/)).toBeVisible();
	await expect(page.locator(`[data-task="${task}"]`)).toBeVisible();
	await expect(page.getByRole('checkbox')).toHaveCount(0);
	await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);

	const revoked = owner.page.waitForResponse(r => r.url().includes('/api/shares') && r.request().method() === 'DELETE');
	await shareSheet(owner.page).getByRole('button', { name: 'Stop sharing' }).click();
	await expect(shareSheet(owner.page).getByLabel('Link')).toHaveCount(0);
	expect((await revoked).ok()).toBe(true);
	await page.reload();
	await expect(page.getByText('This link no longer works')).toBeVisible({ timeout: 15_000 });
});
