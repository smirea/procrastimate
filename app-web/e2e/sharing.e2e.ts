import type { Page } from '@playwright/test';
import {
	type Device,
	deviceContext,
	expect,
	goOffline,
	goOnline,
	ownerWithProject,
	shareWith,
	test,
	unique,
} from './fixtures.ts';

test.describe.configure({ mode: 'serial' });

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const shareSheet = (page: Page) => page.getByRole('dialog', { name: 'Share' });

async function sharedWithMe({ app, page }: Device) {
	if (page.viewportSize()!.width < 768) await app.openNavigation();
	return sidebar(page).getByRole('region', { name: 'Shared with me' });
}

test('a guest completes a task in a project shared with them, and the owner sees who did it', async ({ devices }) => {
	const guest = await devices.open({ person: 'Gus', path: '/inbox', heading: 'Inbox' });
	const { owner, project, task } = await ownerWithProject(devices);

	await shareWith(owner, guest);

	const shared = await sharedWithMe(guest);
	await expect(shared.getByRole('link', { name: new RegExp(project) })).toBeVisible({ timeout: 10_000 });
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

	await expect(owner.app.row(task)).toHaveCount(0, { timeout: 10_000 });
	await owner.app.openSearch();
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

	if (owner.page.viewportSize()!.width < 768) await owner.app.openNavigation();
	await owner.app.go(project);
	await (await owner.app.listMenu()).getByRole('menuitemcheckbox', { name: 'Show completed' }).click();
	await owner.page.keyboard.press('Escape');
	const completed = owner.page
		.getByRole('list', { name: `Completed ${project} tasks` })
		.locator(`[data-task="${task}"]`);
	await expect(completed.getByLabel('Completed by Gus')).toBeVisible();
	await completed.getByRole('checkbox', { name: `Reopen ${task}` }).click();
	await expect(
		owner.page.getByRole('list', { name: `${project} tasks` }).locator(`[data-task="${task}"]`),
	).toBeVisible();
});

test('a guest names a task another guest added to the shared project', async ({ devices }) => {
	const viewer = await devices.open({ person: 'Vera', path: '/inbox', heading: 'Inbox' });
	const adder = await devices.open({ person: 'Gus', path: '/inbox', heading: 'Inbox' });
	const { owner, project } = await ownerWithProject(devices);
	await shareWith(owner, adder);
	await shareWith(owner, viewer, 'Can view');

	const theirs = unique('Oat milk');
	await (await sharedWithMe(adder)).getByRole('link', { name: new RegExp(project) }).click({ timeout: 15_000 });
	await expect(adder.page.getByRole('heading', { level: 1, name: project })).toBeVisible();
	await adder.app.add(theirs);
	await expect(adder.app.row(theirs)).toBeVisible();

	await (await sharedWithMe(viewer)).getByRole('link', { name: new RegExp(project) }).click({ timeout: 15_000 });
	await expect(viewer.app.row(theirs)).toContainText(/by\s*Gus/, { timeout: 10_000 });
	await viewer.page.screenshot({ path: 'test-results/sharing/co-guest-named.png' });
	await viewer.page.getByRole('button', { name: 'Filters', exact: true }).click();
	// Creators with equal counts sort by user id, so each is checked on its own.
	const creators = viewer.page.getByRole('dialog', { name: 'Filters' }).getByRole('group', { name: 'Created by' });
	await expect(creators.getByRole('menuitemcheckbox', { name: /Gus/ })).toHaveText(/Gus\s*1/);
	await expect(creators.getByRole('menuitemcheckbox', { name: /Olive/ })).toHaveText(/Olive\s*1/);
});

test('a guest who can only view a shared project gets no add row, and quick add there starts in Inbox', async ({
	devices,
}) => {
	const guest = await devices.open({ person: 'Vera', path: '/inbox', heading: 'Inbox' });
	const { owner, project, task } = await ownerWithProject(devices);

	await shareWith(owner, guest, 'Can view');

	const shared = await sharedWithMe(guest);
	await shared.getByRole('link', { name: new RegExp(project) }).click({ timeout: 15_000 });
	await expect(guest.app.row(task)).toBeVisible();
	await expect(guest.page.getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0);

	await guest.app.openQuickAdd();
	await expect(guest.app.quickAdd().getByText(project)).toHaveCount(0);
	await expect(guest.app.quickAdd().getByText('Inbox')).toBeVisible();
	await guest.page.screenshot({ path: 'test-results/sharing/view-only-quick-add.png' });
	await guest.app.taskInput().fill('Pick up bread #Groceries');
	await expect(guest.app.quickAdd().getByRole('listbox')).not.toContainText(project);
});

test('quick add on any screen files into a project shared to edit', async ({ devices }) => {
	const guest = await devices.open({ person: 'Quinn', path: '/inbox', heading: 'Inbox' });
	const { owner, project } = await ownerWithProject(devices);
	await shareWith(owner, guest);
	const shared = await sharedWithMe(guest);
	await expect(shared.getByRole('link', { name: new RegExp(project) })).toBeVisible({ timeout: 15_000 });
	await guest.page.keyboard.press('Escape');

	await guest.app.openQuickAdd();
	await guest.app.taskInput().fill('Pick up bread #Groceries');
	await expect(guest.app.quickAdd().getByRole('listbox')).toContainText(project);
	await guest.app.taskInput().press('Tab');
	await expect(guest.app.quickAdd().getByRole('button', { name: `Project ${project}` })).toBeVisible();
	await guest.app.taskInput().press('Enter');
	await expect(owner.app.row('Pick up bread')).toBeVisible({ timeout: 15_000 });
});

test('a guest comments on a shared task, and the owner sees it unread until they open it', async ({ devices }) => {
	const guest = await devices.open({ person: 'Gus', path: '/inbox', heading: 'Inbox' });
	const { owner, project, task } = await ownerWithProject(devices);
	await shareWith(owner, guest);

	const shared = await sharedWithMe(guest);
	await shared.getByRole('link', { name: new RegExp(project) }).click({ timeout: 10_000 });
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
	await expect(unread).toHaveText('1', { timeout: 10_000 });
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
test('an edit a guest made offline, after the owner made the share read only, goes back with a notice', async ({
	devices,
}) => {
	const guest = await devices.open({ person: 'Gus', path: '/inbox', heading: 'Inbox' });
	const { owner, project, task } = await ownerWithProject(devices);
	await shareWith(owner, guest);
	const shared = await sharedWithMe(guest);
	await shared.getByRole('link', { name: new RegExp(project) }).click({ timeout: 10_000 });
	await expect(guest.app.row(task)).toBeVisible();

	await goOffline(guest.context);
	const edited = `${task} by Gus`;
	await guest.app.row(task).getByRole('button', { name: task, exact: true }).click();
	const title = guest.app.details().getByRole('textbox', { name: 'Title' });
	await title.fill(edited);
	await title.press('Enter');
	await guest.app.closeDetails();
	await expect(guest.app.row(edited)).toBeVisible();

	await (await owner.app.listMenu()).getByRole('button', { name: 'Share' }).click();
	const removed = owner.page.waitForResponse(r => r.url().includes('/api/shares') && r.request().method() === 'DELETE');
	await shareSheet(owner.page).getByRole('button', { name: 'Remove Gus' }).click();
	expect((await removed).ok()).toBe(true);
	await shareSheet(owner.page).getByRole('button', { name: 'Close share' }).click();
	await shareWith(owner, guest, 'Can view');

	await goOnline(guest.context);
	await expect(guest.page.getByRole('status').filter({ hasText: `Couldn’t save a change to “${edited}”` })).toBeVisible(
		{
			timeout: 15_000,
		},
	);
	await expect(guest.app.row(task)).toBeVisible({ timeout: 10_000 });
	await expect(guest.app.row(edited)).toHaveCount(0);
	await expect(owner.app.row(task)).toBeVisible();
});

test('a public link opens read only for someone who is not signed in', async ({ browser, devices }) => {
	const { owner, project, task } = await ownerWithProject(devices);

	await (await owner.app.listMenu()).getByRole('button', { name: 'Share' }).click();
	await shareSheet(owner.page).getByRole('button', { name: 'Copy link' }).click();
	const link = shareSheet(owner.page).getByLabel('Link');
	await expect(link).toHaveText(/\/s\/.+/);
	const url = new URL((await link.textContent())!);

	const visitor = await deviceContext(browser);
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

test('sharing a second list while the first share sheet still leaves starts from that list’s own people', async ({
	devices,
}) => {
	const guest = await devices.open({ person: 'Gus', path: '/inbox', heading: 'Inbox' });
	const { owner, project: first } = await ownerWithProject(devices);
	const second = unique('Hardware');
	await owner.app.createProject(second);
	await owner.page.goBack();
	await expect(owner.page.getByRole('heading', { level: 1, name: first })).toBeVisible();
	await shareWith(owner, guest);

	// Frozen mid-outro, the first sheet is still on screen and its scrim takes the clicks, so these dispatch directly.
	await owner.page.evaluate(() => document.getAnimations().forEach(animation => animation.pause()));
	await owner.page.goForward();
	await expect(owner.page.getByRole('heading', { level: 1, name: second })).toBeVisible();
	await owner.page.getByRole('button', { name: 'Project actions' }).dispatchEvent('click');
	await owner.page
		.getByRole('dialog', { name: 'Project actions' })
		.getByRole('button', { name: 'Share' })
		.dispatchEvent('click');

	const sheet = shareSheet(owner.page);
	await expect(sheet).toContainText(second);
	await expect(sheet.getByRole('region', { name: 'People with access' })).toHaveCount(0);
	await sheet.getByRole('textbox', { name: 'Email or name' }).fill('Gus');
	await expect(sheet.getByRole('list', { name: 'People found' }).getByRole('button', { name: /Gus/ })).toBeVisible();
});
