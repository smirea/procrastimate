import type { Locator, Page } from '@playwright/test';
import { App, expect, test } from './fixtures';

const sidebarProjects = (page: Page) =>
	page.getByRole('navigation', { name: 'Main' }).getByRole('region', { name: 'Projects' }).getByRole('link');

async function center(locator: Locator) {
	const box = (await locator.boundingBox())!;
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function mouseDrag(page: Page, from: Locator, to: Locator, screenshot?: string) {
	await new App(page).settle();
	const start = await center(from);
	const end = await center(to);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x, end.y, { steps: 12 });
	if (screenshot) {
		await new App(page).settle();
		await page.screenshot({ path: `test-results/projects/${screenshot}.png` });
	}
	await page.mouse.up();
}

test('dragging a project reorders the sidebar, survives a reload, and a plain click still opens it', async ({
	app,
	page,
}) => {
	for (const name of ['Home', 'Work', 'Errands']) await app.createProject(name);
	await expect(sidebarProjects(page)).toHaveText(['Home', 'Work', 'Errands']);

	await mouseDrag(page, app.nav('Errands'), app.nav('Home'), 'desktop-lifted');
	await expect(sidebarProjects(page)).toHaveText(['Errands', 'Home', 'Work']);
	await expect(page.getByRole('heading', { level: 1, name: 'Errands' })).toBeVisible();

	await app.nav('Work').click();
	await expect(page.getByRole('heading', { level: 1, name: 'Work' })).toBeVisible();

	await app.nav('Home').focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect(sidebarProjects(page)).toHaveText(['Errands', 'Work', 'Home']);
	await expect(app.nav('Home')).toBeFocused();

	const last = (await app.nav('Home').boundingBox())!;
	const first = await center(app.nav('Errands'));
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(first.x, last.y + last.height * 2, { steps: 12 });
	await page.mouse.up();
	await expect(sidebarProjects(page)).toHaveText(['Work', 'Home', 'Errands']);

	await page.reload();
	await expect(sidebarProjects(page)).toHaveText(['Work', 'Home', 'Errands']);
	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'Project Work' }).click();
	await expect(page.getByRole('dialog', { name: 'Project' }).locator('.menu-item')).toHaveText([
		'Inbox',
		'Work',
		'Home',
		'Errands',
		'New project',
	]);
});

test('a project lifted while the rows still animate from a move lands where it is dropped', async ({ app, page }) => {
	for (const name of ['Home', 'Work', 'Errands']) await app.createProject(name);
	await app.settle();
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Animation.enable');
	await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });

	await app.nav('Home').focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect(sidebarProjects(page)).toHaveText(['Work', 'Home', 'Errands']);
	const start = await center(app.nav('Errands'));
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x, 0, { steps: 12 });
	await page.mouse.up();
	await expect(sidebarProjects(page)).toHaveText(['Errands', 'Work', 'Home']);

	await app.nav('Errands').focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect(sidebarProjects(page)).toHaveText(['Work', 'Errands', 'Home']);
	const drawn = (await app.nav('Errands').boundingBox())!;
	const grab = { x: drawn.x + drawn.width / 2, y: drawn.y + drawn.height / 2 };
	await page.mouse.move(grab.x, grab.y);
	await page.mouse.down();
	await page.mouse.move(grab.x, grab.y - drawn.height * 0.6, { steps: 6 });
	await page.mouse.up();
	await expect(sidebarProjects(page)).toHaveText(['Errands', 'Work', 'Home']);
});

test.describe('in a short window', () => {
	test.use({ viewport: { width: 1280, height: 480 } });

	test('dragging a project to the sidebar edge scrolls it, so the project lands past the fold', async ({
		app,
		page,
	}) => {
		const names = [
			'Alpha',
			'Bravo',
			'Charlie',
			'Delta',
			'Echo',
			'Foxtrot',
			'Golf',
			'Hotel',
			'India',
			'Juliet',
			'Kilo',
			'Lima',
			'Mike',
			'November',
			'Oscar',
			'Papa',
			'Quebec',
			'Romeo',
			'Sierra',
			'Tango',
		];
		for (const name of names) await app.createProject(name);
		const first = app.nav('Alpha');
		await first.scrollIntoViewIfNeeded();
		await app.settle();
		await expect(app.nav('Tango')).not.toBeInViewport();

		const start = await center(first);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x, 475, { steps: 12 });
		await expect(app.nav('Tango')).toBeInViewport();
		await expect(page.locator('[data-project-id]', { hasText: 'Tango' })).toHaveAttribute('style', /translateY\(-/);
		await page.screenshot({ path: 'test-results/projects/desktop-autoscroll.png' });
		await page.mouse.up();
		await expect(sidebarProjects(page)).toHaveText([...names.slice(1), 'Alpha']);
	});
});

test('the new order shows on another device', async ({ app, page, devices }) => {
	for (const name of ['Home', 'Work']) await app.createProject(name);
	await mouseDrag(page, app.nav('Work'), app.nav('Home'));
	await expect(sidebarProjects(page)).toHaveText(['Work', 'Home']);

	const other = await devices.open({ path: '/inbox', heading: 'Inbox' });
	await expect(sidebarProjects(other.page)).toHaveText(['Work', 'Home'], { timeout: 10_000 });
	await mouseDrag(other.page, other.app.nav('Home'), other.app.nav('Work'));
	await expect(sidebarProjects(page)).toHaveText(['Home', 'Work'], { timeout: 10_000 });
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

	test('a long press lifts a project and dragging moves it, leaving the drawer open', async ({ app, page }) => {
		await page.getByRole('button', { name: 'Open navigation' }).tap();
		for (const name of ['Home', 'Work', 'Errands']) {
			await app.createProject(name);
			await page.getByRole('button', { name: 'Open navigation' }).tap();
		}
		await expect(sidebarProjects(page)).toHaveText(['Home', 'Work', 'Errands']);
		const cdp = await page.context().newCDPSession(page);
		const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: { x: number; y: number }) =>
			cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });

		await app.settle();
		const start = await center(app.nav('Errands'));
		const end = await center(app.nav('Home'));
		await touch('touchStart', start);
		await expect(page.locator('[data-project-id].lifted')).toHaveCount(1);
		for (let i = 1; i <= 10; i++) await touch('touchMove', { x: start.x, y: start.y + ((end.y - start.y) * i) / 10 });
		await app.settle();
		await page.screenshot({ path: 'test-results/projects/phone-lifted.png' });
		await touch('touchEnd');
		await expect(sidebarProjects(page)).toHaveText(['Errands', 'Home', 'Work']);
		await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'true');
	});
});

test('create, assign with #, move, rename, delete, and undo deleting a project', async ({ app, page }) => {
	await app.createProject('Home');
	await expect(page.getByText('No tasks yet')).toBeVisible();

	await app.add('Fix sink #home', 'Paint fence');
	const home = app.list('Home tasks');
	await expect(home.locator('[data-task]')).toHaveText([/Fix sink/, /Paint fence/]);
	await expect(home).not.toContainText('#home');

	await app.go('Inbox');
	await app.add('Buy milk');
	await app.row('Buy milk').getByRole('button', { name: 'Buy milk', exact: true }).click();
	await app.details().getByRole('button', { name: 'Project Inbox' }).click();
	await page.getByRole('dialog', { name: 'Project' }).getByRole('button', { name: 'Home', exact: true }).click();
	await expect(app.details().getByRole('button', { name: 'Project Home' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(app.details()).toBeHidden();
	await expect(app.row('Buy milk')).toHaveCount(0);

	await app.nav('Home').click();
	await expect(home.locator('[data-task]')).toHaveCount(3);
	await page.getByRole('button', { name: 'Project actions' }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	await page.getByRole('textbox', { name: 'Project name' }).fill('House');
	await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'House' })).toBeVisible();
	await expect(sidebarProjects(page)).toHaveText([/House/]);

	await page.getByRole('button', { name: 'Project actions' }).click();
	await page.getByRole('button', { name: 'Delete project' }).click();
	await expect(page.getByText('Delete House and its 3 tasks?')).toBeVisible();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(sidebarProjects(page)).toHaveCount(0);
	await expect(page.locator('[data-task]')).toHaveCount(0);

	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(sidebarProjects(page)).toHaveText([/House/]);
	await app.nav('House').click();
	await expect(app.list('House tasks').locator('[data-task]')).toHaveText([/Fix sink/, /Paint fence/, /Buy milk/]);
});

test('Show completed is per project, and a completed task deletes with undo', async ({ app, page }) => {
	await app.createProject('Home');
	await app.add('Sweep porch');
	await app.createProject('Garden');
	await app.add('Rake leaves');
	await app.row('Rake leaves').getByRole('checkbox', { name: 'Complete Rake leaves' }).click();
	await expect(app.row('Rake leaves')).toHaveCount(0);

	await page.getByRole('button', { name: 'Show completed' }).click();
	const done = app.list('Completed Garden tasks').locator('[data-task="Rake leaves"]');
	await expect(done).toBeVisible();
	await app.nav('Home').click();
	await expect(page.getByRole('button', { name: 'Show completed' })).toHaveAttribute('aria-pressed', 'false');
	await app.nav('Garden').click();
	await expect(page.getByRole('button', { name: 'Show completed' })).toHaveAttribute('aria-pressed', 'true');

	await done.hover();
	await app.settle();
	await page.screenshot({ path: 'test-results/projects/completed-row.png' });
	await page.getByRole('button', { name: 'Delete Rake leaves' }).click();
	const toast = page.getByRole('status').filter({ hasText: 'Deleted “Rake leaves”' });
	await expect(toast).toBeVisible();
	await expect(app.row('Rake leaves')).toHaveCount(0);
	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(done).toBeVisible();

	await page.reload();
	await expect(page.getByRole('button', { name: 'Show completed' })).toHaveAttribute('aria-pressed', 'true');
	await expect(done).toBeVisible();
});
