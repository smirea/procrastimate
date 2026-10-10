import { expect, test, type App } from './fixtures.ts';

const dialog = (app: App) => app.page.getByRole('dialog', { name: 'Search' });
const field = (app: App) => dialog(app).getByRole('combobox', { name: 'Search' });
const results = (app: App) => app.page.getByRole('listbox', { name: 'Search results' });
const group = (app: App, name: string) => results(app).getByRole('group', { name: new RegExp(`^${name}`) });

async function seed(app: App) {
	await app.createProject('Home');
	await app.go('Inbox');
	await app.add('Fix sink #Home p2', 'Water plants tomorrow', 'Call plumber', 'Buy milk');
	await app
		.row('Call plumber')
		.getByRole('button', { name: /Call plumber/ })
		.click();
	await app.details().getByRole('textbox', { name: 'Notes' }).fill('Ask about the home warranty');
	await app.details().getByRole('button', { name: 'Close' }).click();
}

async function openSearch(app: App) {
	await app.page.keyboard.press('/');
	await expect(field(app)).toBeFocused();
}

test('/ and Cmd-K or Ctrl-K open search, but typing in a field never does', async ({ app, page }) => {
	await openSearch(app);
	await page.keyboard.press('Escape');
	await expect(dialog(app)).toBeHidden();

	await page.keyboard.press('ControlOrMeta+k');
	await expect(field(app)).toBeFocused();
	await page.keyboard.press('ControlOrMeta+k');
	await expect(dialog(app)).toBeHidden();

	await app.openQuickAdd();
	await app.taskInput().pressSequentially('Read 1/2 of book');
	await app.taskInput().press('ControlOrMeta+k');
	await expect(app.taskInput()).toHaveValue('Read 1/2 of book');
	await expect(dialog(app)).toHaveCount(0);
	await app.taskInput().press('Escape');

	await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Search' }).click();
	await expect(field(app)).toBeFocused();
});

test('search matches titles, notes, and projects, highlights them, and the keyboard opens a task', async ({
	app,
	page,
}) => {
	await seed(app);
	await openSearch(app);
	await field(app).pressSequentially('home');

	await expect(group(app, 'Projects').getByRole('option')).toHaveText(['Home']);
	await expect(group(app, 'Tasks').getByRole('option')).toHaveText([
		/Fix sink\s+Home/,
		/Call plumber\s+Ask about the home warranty\s+Inbox/,
	]);
	await expect(results(app).locator('mark')).toHaveText(['Home', 'Home', 'home']);
	await expect(results(app).getByRole('option', { name: 'Home', exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	);
	await app.settle();
	await page.screenshot({ path: 'test-results/search/desktop-light.png' });
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.expectTheme('dark');
	await app.settle();
	await page.screenshot({ path: 'test-results/search/desktop-dark.png' });

	await field(app).press('ArrowDown');
	await field(app).press('ArrowDown');
	await expect(results(app).getByRole('option', { name: /Call plumber/ })).toHaveAttribute('aria-selected', 'true');
	await field(app).press('Enter');
	await expect(dialog(app)).toHaveCount(0);
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Call plumber');
});

test('every word must match, and a miss says so', async ({ app }) => {
	await seed(app);
	await openSearch(app);
	await field(app).pressSequentially('sink home');
	await expect(results(app).getByRole('option')).toHaveText([/Fix sink/]);
	await field(app).fill('sink garden');
	await expect(results(app)).toHaveText('No results for “sink garden”');
});

test('a project result opens the project', async ({ app, page }) => {
	await seed(app);
	await openSearch(app);
	await field(app).pressSequentially('hom');
	await field(app).press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await expect(dialog(app)).toHaveCount(0);
});

test('completed tasks list after open ones and reopen from details', async ({ app }) => {
	await app.add('Renew passport', 'Passport photos');
	await app.row('Renew passport').getByRole('checkbox', { name: 'Complete Renew passport' }).click();
	await expect(app.row('Renew passport')).toHaveCount(0);

	await openSearch(app);
	await field(app).pressSequentially('passport');
	await expect(group(app, 'Tasks').getByRole('option')).toHaveText([/Passport photos/]);
	await expect(group(app, 'Completed').getByRole('option')).toHaveText([/Renew passport\s+Completed Today/]);

	await group(app, 'Completed').getByRole('option').click();
	await app.details().getByRole('button', { name: 'Reopen' }).click();
	await expect(app.details().getByRole('button', { name: 'Complete' })).toBeVisible();
	await app.details().getByRole('button', { name: 'Close' }).click();
	await expect(app.list('Inbox tasks').getByRole('listitem')).toHaveText([/Renew passport/, /Passport photos/]);
});

test('a label matches its tasks and opens the label view', async ({ app, page }) => {
	await app.openQuickAdd();
	for (const name of ['calls', 'waiting']) {
		await app.taskInput().pressSequentially(`@${name}`);
		await app.taskInput().press('Enter');
	}
	for (const title of ['Plumber @calls', 'Dentist @waiting @calls', 'Read a book']) {
		await app.taskInput().fill(title);
		await app.taskInput().press('Enter');
		await expect(app.taskInput()).toHaveValue('');
	}
	await app.taskInput().press('Escape');
	await expect(app.quickAdd()).toBeHidden();

	await page.locator('body').click({ position: { x: 1200, y: 700 } });
	await openSearch(app);
	await field(app).fill('call');
	await expect(group(app, 'Labels').getByRole('option')).toHaveText(['calls']);
	await expect(group(app, 'Tasks').getByRole('option')).toHaveText([/Plumber.*calls/, /Dentist.*calls/]);
	await expect(group(app, 'Tasks').locator('mark')).toHaveText(['call', 'call']);
	await expect(group(app, 'Labels').getByRole('option')).toHaveAttribute('aria-selected', 'true');
	await app.settle();
	await page.screenshot({ path: 'test-results/search/labels.png' });

	await field(app).fill('dentist waiting');
	await expect(group(app, 'Tasks').getByRole('option')).toHaveText([/Dentist/]);

	await field(app).fill('wait');
	await field(app).press('Enter');
	await expect(dialog(app)).toBeHidden();
	await expect(page.getByRole('heading', { level: 1, name: 'waiting' })).toBeVisible();
	await expect(app.list('waiting tasks').getByRole('listitem')).toHaveText([/Dentist/]);
});
