import { App, expect, NOW, test as base } from '../fixtures.ts';

/**
 * The web half of the iOS parity pairs. `app` launches like the XCUITests' `launch()`: a fresh profile at the pinned
 * moment, opened at `/`. `snap` saves `test-results/parity/<parity-id>.png` for the side-by-side report.
 */
export const test = base.extend<{ snap: (id: string) => Promise<void> }>({
	app: async ({ page }, use) => {
		await page.clock.setFixedTime(NOW);
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await use(new App(page));
	},
	snap: async ({ page }, use) => {
		await use(async id => {
			await page.screenshot({ path: `test-results/parity/${id}.png` });
		});
	},
});

export { expect };
