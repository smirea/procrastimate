import { expect, test, type App } from './fixtures.ts';

const suggestions = (app: App) => app.page.getByRole('listbox', { name: 'Projects' });

async function seedProjects(app: App) {
	await app.createProject('Home');
	await app.createProject('Homework');
	await app.createProject('Errands');
	await app.go('Inbox');
}

test('# suggests projects as you type and the keyboard picks one', async ({ app, page }) => {
	await seedProjects(app);
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('Fix sink #ho');

	await expect(suggestions(app).getByRole('option')).toHaveText(['Home', 'Homework', 'Create project “ho”']);
	await expect(suggestions(app).getByRole('option', { name: 'Home', exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	);
	const listBox = (await suggestions(app).boundingBox())!;
	const inputBox = (await app.taskInput().boundingBox())!;
	expect(listBox.y + listBox.height).toBeLessThanOrEqual(inputBox.y);
	await app.settle();
	await page.screenshot({ path: 'test-results/project-autocomplete.png' });

	await app.taskInput().press('ArrowDown');
	await expect(suggestions(app).getByRole('option', { name: 'Homework' })).toHaveAttribute('aria-selected', 'true');
	await app.taskInput().press('Enter');
	await expect(suggestions(app)).toBeHidden();
	await expect(app.taskInput()).toHaveValue('Fix sink #Homework ');
	await expect(app.quickAdd().getByRole('button', { name: 'Project Homework' })).toBeVisible();

	await app.taskInput().pressSequentially('#e');
	await expect(suggestions(app).getByRole('option')).toHaveText(['Errands', 'Home', 'Homework', 'Create project “e”']);
	await app.taskInput().press('Escape');
	await expect(suggestions(app)).toBeHidden();
	await expect(app.quickAdd()).toBeVisible();
	await app.taskInput().pressSequentially('r');
	await expect(suggestions(app)).toBeHidden();
	await app.taskInput().press('Backspace');
	await app.taskInput().press('Backspace');
	await app.taskInput().press('Backspace');
	await app.taskInput().pressSequentially('#rr');
	await app.taskInput().press('Tab');
	await expect(app.taskInput()).toHaveValue('Fix sink #Homework #Errands ');

	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await app.go('Errands');
	await expect(app.list('Errands tasks').getByRole('listitem')).toHaveText([/Fix sink/]);
});

test('# offers to create a project that does not exist', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('Plant tomatoes #Garden');
	await expect(suggestions(app).getByRole('option')).toHaveText(['Create project “Garden”']);
	await page.screenshot({ path: 'test-results/project-autocomplete-create.png' });
	await app.taskInput().press('Enter');

	await expect(app.taskInput()).toHaveValue('Plant tomatoes #Garden ');
	await expect(app.quickAdd().locator('[data-token="project"]')).toHaveText('#Garden');
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Garden' }).click();
	await expect(app.list('Garden tasks').getByRole('listitem')).toHaveText([/Plant tomatoes/]);
});

test('a fully typed project name still saves on Enter', async ({ app }) => {
	await seedProjects(app);
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('Fix sink #home');
	await expect(suggestions(app).getByRole('option')).toHaveText(['Home', 'Homework']);
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
});

test('# autocompletes in the task details title and a click picks', async ({ app }) => {
	await seedProjects(app);
	await app.add('Buy milk');
	await app
		.row('Buy milk')
		.getByRole('button', { name: /Buy milk/ })
		.click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.click();
	await title.press('End');
	await title.pressSequentially(' #err');
	await suggestions(app).getByRole('option', { name: 'Errands' }).click();
	await expect(title).toHaveValue('Buy milk #Errands ');
	await expect(title).toBeFocused();
	await title.press('Enter');
	await expect(app.details().getByRole('button', { name: 'Project Errands' })).toBeVisible();
	await expect(title).toHaveValue('Buy milk');
});
