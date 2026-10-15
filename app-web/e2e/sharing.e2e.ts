import type { Browser, BrowserContext, Page } from '@playwright/test';
import { App, E2E_PASSWORD, expect, NOW, test } from './fixtures.ts';

/**
 * Two people, each with their own account in their own browser context. The owner shares a project with the
 * guest's email; a public link opens read only for a visitor who never signed in.
 */

type Person = { app: App; page: Page; context: BrowserContext; email: string; name: string };

const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

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
	await shareSheet(owner.page).getByRole('list', { name: 'People found' }).getByRole('button', { name: /Gus/ }).click();
	await expect(shareSheet(owner.page).getByRole('region', { name: 'People with access' })).toContainText('Gus');
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
	await expect(details.getByRole('list', { name: 'Activity list' })).toContainText(/Gus\s*completed it/);
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

	await shareSheet(owner.page).getByRole('button', { name: 'Stop sharing' }).click();
	await expect(shareSheet(owner.page).getByLabel('Link')).toHaveCount(0);
	await page.reload();
	await expect(page.getByText('This link no longer works')).toBeVisible({ timeout: 15_000 });
});
