import type { Locator, Page } from '@playwright/test';
import { App, expect, NOW, signInAccount, test } from './fixtures';

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

test('the new order shows on another device', async ({ app, page, browser }) => {
	for (const name of ['Home', 'Work']) await app.createProject(name);
	await mouseDrag(page, app.nav('Work'), app.nav('Home'));
	await expect(sidebarProjects(page)).toHaveText(['Work', 'Home']);

	const { baseURL, timezoneId, viewport } = test.info().project.use;
	const context = await browser.newContext({ baseURL, timezoneId, viewport });
	await signInAccount(context);
	const other = await context.newPage();
	await other.clock.setFixedTime(NOW);
	await other.goto('/inbox');
	await expect(sidebarProjects(other)).toHaveText(['Work', 'Home'], { timeout: 10_000 });
	await mouseDrag(other, new App(other).nav('Home'), new App(other).nav('Work'));
	await expect(sidebarProjects(page)).toHaveText(['Home', 'Work'], { timeout: 10_000 });
	await context.close();
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
