import { expect, test } from './fixtures';

test('project and section headers count open tasks only above 4, and drop as tasks complete', async ({ app, page }) => {
	await app.createProject('Errands');
	const header = page.locator('header', { has: page.getByRole('heading', { level: 1, name: 'Errands' }) });
	const later = page.getByRole('region', { name: 'Later' });

	await app.add('Bank', 'Post office', 'Pharmacy', 'Dry cleaner');
	await expect(app.list('Errands tasks').locator('[data-task]')).toHaveCount(4);
	await expect(header.getByText(/open tasks/)).toHaveCount(0);

	await app.add('Hardware store');
	await expect(header.getByText('5 open tasks')).toBeVisible();

	await page.getByRole('button', { name: 'Add section' }).click();
	await page.getByRole('textbox', { name: 'New section name' }).fill('Later');
	await page.getByRole('textbox', { name: 'New section name' }).press('Enter');
	await app.add(
		'Tailor #Errands /Later',
		'Florist #Errands /Later',
		'Bakery #Errands /Later',
		'Library #Errands /Later',
	);
	await expect(later.getByRole('listitem')).toHaveCount(4);
	await expect(later.getByText(/open tasks/)).toHaveCount(0);
	await expect(header.getByText('9 open tasks')).toBeVisible();

	await app.add('Garden centre #Errands /Later');
	await expect(later.getByText('5 open tasks')).toBeVisible();
	await expect(header.getByText('10 open tasks')).toBeVisible();
	await app.settle();
	await page.screenshot({ path: 'test-results/pending-count/project.png' });

	await page.getByRole('checkbox', { name: 'Complete Tailor', exact: true }).click();
	await expect(later.getByText(/open tasks/)).toHaveCount(0);
	await expect(header.getByText('9 open tasks')).toBeVisible();
});
