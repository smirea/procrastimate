import { App, expect, NOW, test as base } from '../fixtures.ts';

export { NOW };
export const YESTERDAY = new Date(NOW.getTime() - 86_400_000);

/** The phone layout's handles, named like the XCUITests' `ParityHelpers`. */
export class PhoneApp extends App {
	checkbox = (title: string) => this.page.getByRole('checkbox', { name: `Complete ${title}` });
	toast = (text: string) => this.page.getByRole('status').filter({ hasText: text });
	highlight = (kind: string) => this.quickAdd().locator(`[data-token="${kind}"]`);

	async openQuickAdd() {
		await this.page.getByRole('button', { name: 'Quick add' }).tap();
		await expect(this.taskInput()).toBeFocused();
	}

	/** Adds each task with the keyboard's return key, then dismisses the sheet. */
	async add(...titles: string[]) {
		await this.openQuickAdd();
		for (const title of titles) {
			await this.taskInput().fill(title);
			await this.taskInput().press('Enter');
			await expect(this.taskInput()).toHaveValue('');
		}
		await this.cancelQuickAdd();
	}

	async type(text: string) {
		await this.taskInput().pressSequentially(text);
	}

	async cancelQuickAdd() {
		await this.quickAdd().getByRole('button', { name: 'Cancel' }).tap();
		await expect(this.quickAdd()).toBeHidden();
	}

	async go(view: string) {
		await this.page.getByRole('button', { name: 'Open navigation' }).tap();
		await this.nav(view).tap();
		await expect(this.page.getByRole('heading', { level: 1, name: view })).toBeVisible();
	}

	/** Reloads at another pinned moment on the same data, like the XCUITests' `relaunch`. */
	async relaunch(now: Date) {
		await this.setNow(now);
		await this.page.reload();
		await expect(this.page.getByRole('heading', { level: 1 })).toBeVisible();
	}
}

/**
 * The web half of the iOS parity pairs. `app` launches like the XCUITests' `launch()`: a fresh profile at the pinned
 * moment, opened at `/`. `snap` saves `test-results/parity/<parity-id>.png` for the side-by-side report.
 */
export const test = base.extend<{ app: PhoneApp; snap: (id: string) => Promise<void> }>({
	app: async ({ page }, use) => {
		await page.clock.setFixedTime(NOW);
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await use(new PhoneApp(page));
	},
	snap: async ({ page }, use) => {
		await use(async id => {
			await new App(page).settle();
			await page.screenshot({ path: `test-results/parity/${id}.png` });
		});
	},
});

export { expect };
