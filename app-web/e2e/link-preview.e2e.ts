import { expect, test } from './fixtures';

/** A 1×1 PNG, standing in for a site's icon. */
const ICON = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
	'base64',
);

test('a pasted URL becomes a link titled by its page, with the site’s icon before it in the row', async ({
	app,
	page,
	context,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const previewed: string[] = [];
	await page.route('**/api/link-preview?*', async route => {
		previewed.push(new URL(route.request().url()).searchParams.get('url')!);
		await new Promise(resolve => setTimeout(resolve, 300));
		await route.fulfill({ json: { title: 'The [Example] Page' } });
	});
	await page.route('**/api/favicon?*', route => route.fulfill({ body: ICON, contentType: 'image/png' }));

	await app.openQuickAdd();
	const input = app.taskInput();
	await input.pressSequentially('Read ');
	await page.evaluate(() => navigator.clipboard.writeText('https://example.com/page'));
	await input.press('ControlOrMeta+V');
	await expect(input).toHaveValue('Read https://example.com/page');
	await expect(input).toHaveValue('Read [The (Example) Page](https://example.com/page)');
	await input.pressSequentially(' later');
	await expect(input).toHaveValue('Read [The (Example) Page](https://example.com/page) later');

	await page.evaluate(() => navigator.clipboard.writeText('see https://example.com/other'));
	await input.press('ControlOrMeta+V');
	await expect(input).toHaveValue(
		'Read [The (Example) Page](https://example.com/page) latersee https://example.com/other',
	);
	expect(previewed).toEqual(['https://example.com/page']);

	await input.fill('Read [The (Example) Page](https://example.com/page) later');
	await app.save();
	await app.showAdded();
	const link = app
		.row('Read [The (Example) Page](https://example.com/page) later')
		.getByRole('link', { name: 'The (Example) Page' });
	await expect(link).toHaveAttribute('href', 'https://example.com/page');
	const icon = link.locator('img');
	await expect(icon).toHaveAttribute('src', '/api/favicon?url=https%3A%2F%2Fexample.com%2Fpage');
	await expect.poll(() => icon.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1);
	await app.settle();
	await page.screenshot({ path: 'test-results/link-preview/row.png' });
});

test('a link whose site has no icon shows its text alone', async ({ app, page }) => {
	await page.route('**/api/favicon?*', route => route.fulfill({ status: 404 }));
	await app.add('Check https://no-icon.example');
	const link = app.row('Check https://no-icon.example').getByRole('link', { name: 'https://no-icon.example' });
	await expect(link).toBeVisible();
	await expect(link.locator('img')).toHaveCount(0);
});
