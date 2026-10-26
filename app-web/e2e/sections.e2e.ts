import { NOW, expect, test } from './fixtures';

test('sections group a project, take tasks from quick add and details, and rename, reorder, and delete', async ({
	app,
	page,
	context,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const sectionHeadings = () => page.getByRole('main').getByRole('heading', { level: 2 });
	await app.createProject('Home');
	await app.add('Water plants');

	const addSection = async (name: string) => {
		await page.getByRole('button', { name: 'Add section' }).click();
		const input = page.getByRole('textbox', { name: 'New section name' });
		await input.fill(name);
		await input.press('Enter');
		await expect(page.getByRole('region', { name })).toBeVisible();
	};
	await addSection('Later');
	await app.setNow(new Date(NOW.getTime() + 60_000));
	await addSection('Next up');

	const later = page.getByRole('region', { name: 'Later' });
	await later.getByRole('button', { name: 'Add task to Later' }).click();
	await app.taskInput().fill('Fix fence');
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home / Later' })).toBeVisible();
	await app.taskInput().press('Enter');
	await expect(page.getByRole('list', { name: 'Later tasks' }).locator('[data-task="Fix fence"]')).toBeVisible();
	await expect(app.quickAdd()).toBeHidden();
	await app.settle();

	await app.openQuickAdd();
	await app.taskInput().fill('Paint door #Home /next');
	await expect(app.quickAdd().getByRole('listbox')).toContainText('Next up');
	await app.settle();
	await page.screenshot({ path: 'test-results/sections/quick-add.png' });
	await app.taskInput().press('Tab');
	await expect(app.taskInput()).toHaveValue('Paint door #Home /Next up ');
	await app.taskInput().press('Enter');
	await expect(page.getByRole('list', { name: 'Next up tasks' }).locator('[data-task="Paint door"]')).toBeVisible();

	await app.row('Water plants').click();
	await app.details().getByRole('button', { name: 'Project Home' }).click();
	await app.details().getByRole('button', { name: 'Next up' }).click();
	await expect(app.details().getByRole('button', { name: 'Project Home / Next up' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('list', { name: 'Next up tasks' }).locator('[data-task]')).toHaveText([
		/Water plants/,
		/Paint door/,
	]);
	await expect(page.getByRole('list', { name: 'Home tasks' }).locator('[data-task]')).toHaveCount(0);

	await (await app.listMenu()).getByRole('button', { name: 'Copy as Markdown' }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		'# Home\n\n## Later\n\n- Fix fence\n\n## Next up\n\n- Water plants\n- Paint door',
	);
	await page.screenshot({ path: 'test-results/sections/project.png' });

	await expect(later.getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Next up actions' }).click();
	await expect(page.getByRole('dialog', { name: 'Section actions' })).toContainText(/^Next up/);
	await app.settle();
	await page.screenshot({ path: 'test-results/sections/menu.png' });
	await page.getByRole('button', { name: 'Move up' }).click();
	await app.settle();
	await expect(sectionHeadings()).toHaveText([/^Next up/, /^Later/]);

	await page.getByRole('button', { name: 'Later actions' }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	const name = page.getByRole('textbox', { name: 'Section name' });
	await name.fill('Dropped');
	await name.press('Escape');
	await expect(page.getByRole('region', { name: 'Later' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Dropped' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Later actions' }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	await name.fill('Someday');
	await name.press('Enter');
	await expect(page.getByRole('region', { name: 'Someday' })).toBeVisible();

	await app.reload();
	await expect(sectionHeadings()).toHaveText([/^Next up/, /^Someday/]);

	await page.getByRole('button', { name: 'Someday actions' }).click();
	await page.getByRole('button', { name: 'Delete section' }).click();
	await expect(page.getByText('Delete Someday and its 1 task?')).toBeVisible();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByRole('region', { name: 'Someday' })).toHaveCount(0);
	await expect(app.row('Fix fence')).toHaveCount(0);
	await expect(app.row('Paint door')).toBeVisible();
});
