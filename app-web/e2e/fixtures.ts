import { expect, test as base, type Page } from '@playwright/test';

/** Wednesday, October 14 2026, 10:00 UTC. The suite runs in the UTC time zone. */
export const NOW = new Date('2026-10-14T10:00:00Z');

export const test = base.extend<{ app: App }>({
	app: async ({ page }, use) => {
		await page.clock.setFixedTime(NOW);
		await page.goto('/inbox');
		await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
		await use(new App(page));
	},
});

export { expect };

export class App {
	constructor(readonly page: Page) {}

	quickAdd = () => this.page.getByRole('dialog', { name: 'Quick add' });
	taskInput = () => this.quickAdd().getByRole('textbox', { name: 'Task name' });
	details = () => this.page.getByRole('dialog', { name: 'Task details' });
	row = (title: string) => this.page.locator(`[data-task="${title}"]`);
	list = (name: string) => this.page.getByRole('list', { name });
	nav = (name: string) => this.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name });

	async openQuickAdd() {
		await this.page.locator('body').click({ position: { x: 1200, y: 700 } });
		await this.page.keyboard.press('q');
		await expect(this.taskInput()).toBeFocused();
	}

	/** Adds each task through quick add, then closes it. */
	async add(...titles: string[]) {
		await this.openQuickAdd();
		for (const title of titles) {
			await this.taskInput().fill(title);
			await this.taskInput().press('Enter');
			await expect(this.taskInput()).toHaveValue('');
		}
		await this.taskInput().press('Escape');
		await expect(this.quickAdd()).toBeHidden();
	}

	async go(view: string) {
		await this.nav(view).click();
		await expect(this.page.getByRole('heading', { level: 1, name: view })).toBeVisible();
	}

	async createProject(name: string) {
		await this.page.getByRole('button', { name: 'Add project' }).click();
		const input = this.page.getByRole('textbox', { name: 'Project name' });
		await input.fill(name);
		await input.press('Enter');
		await expect(this.page.getByRole('heading', { level: 1, name })).toBeVisible();
	}

	/** Waits for running animations. One that is cancelled, as when a newer transition replaces it, counts as settled. */
	settle() {
		return this.page.evaluate(() =>
			Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))),
		);
	}

	async setNow(date: Date) {
		await this.page.clock.setFixedTime(date);
	}

	themeOption = (name: 'System' | 'Light' | 'Dark') =>
		this.page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name });

	/** The theme the user sees: `<html>`'s theme, the canvas the page paints, and the browser chrome around it. */
	async expectTheme(theme: 'light' | 'dark') {
		await expect(this.page.locator('html')).toHaveAttribute('data-theme', theme);
		await expect(this.page.locator('body')).toHaveCSS(
			'background-color',
			theme === 'dark' ? 'rgb(14, 14, 16)' : 'rgb(246, 246, 247)',
		);
		await this.expectChrome(theme);
	}

	async expectChrome(theme: 'light' | 'dark') {
		await expect(this.page.locator('meta[name="theme-color"]')).toHaveAttribute(
			'content',
			theme === 'dark' ? '#0e0e10' : '#f6f6f7',
		);
	}

	/**
	 * Reloads and snapshots the page the moment `<body>` is parsed. Nothing can paint before that,
	 * and the app's deferred module scripts have not run yet, so this is what the first frame uses.
	 */
	async expectFirstPaintTheme(theme: 'light' | 'dark') {
		await this.page.addInitScript(() => {
			new MutationObserver((_, observer) => {
				if (!document.body) return;
				observer.disconnect();
				const root = document.documentElement;
				sessionStorage.setItem(
					'first-paint',
					JSON.stringify({
						theme: root.dataset.theme,
						colorScheme: getComputedStyle(root).colorScheme,
						chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
					}),
				);
			}).observe(document, { childList: true, subtree: true });
		});
		await this.page.evaluate(() => sessionStorage.removeItem('first-paint'));
		await this.page.reload();
		await expect(this.page.getByRole('heading', { level: 1 })).toBeVisible();
		expect(JSON.parse((await this.page.evaluate(() => sessionStorage.getItem('first-paint')))!)).toEqual({
			theme,
			colorScheme: theme,
			chrome: theme === 'dark' ? '#0e0e10' : '#f6f6f7',
		});
	}
}
