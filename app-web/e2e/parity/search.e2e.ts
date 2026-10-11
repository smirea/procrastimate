import { expect, test, type PhoneApp } from './fixtures.ts';

const nav = (app: PhoneApp) => app.page.getByRole('navigation', { name: 'Main' });
const field = (app: PhoneApp) => app.page.getByRole('combobox', { name: 'Search' });
const results = (app: PhoneApp) => app.page.getByRole('listbox', { name: 'Search results' });
const group = (app: PhoneApp, name: string) => results(app).getByRole('group', { name: new RegExp(`^${name}`) });
const option = (app: PhoneApp, name: string | RegExp) =>
	results(app).getByRole('option', typeof name === 'string' ? { name, exact: true } : { name });

async function openNav(app: PhoneApp) {
	await app.page.getByRole('button', { name: 'Open navigation' }).tap();
	await expect(nav(app)).toBeVisible();
}

/** Opens search from the drawer, the phone's search tab, and types `query` into a fresh field. */
async function search(app: PhoneApp, query: string) {
	if (!(await field(app).isVisible())) {
		await openNav(app);
		await nav(app).getByRole('button', { name: 'Search' }).tap();
	}
	await field(app).fill(query);
}

async function createLabels(app: PhoneApp, ...names: string[]) {
	await app.openQuickAdd();
	for (const name of names) {
		await app.type(`@${name}`);
		await app
			.quickAdd()
			.getByRole('option', { name: `Create label “${name}”` })
			.tap();
	}
	await app.cancelQuickAdd();
}

/** The search feature map's seed, minus the notes, which only task details can set on iOS until S6. */
async function seedHome(app: PhoneApp) {
	await openNav(app);
	await app.page.getByRole('button', { name: 'Add project' }).tap();
	await app.page.getByRole('textbox', { name: 'Project name' }).fill('Home');
	await app.page.getByRole('textbox', { name: 'Project name' }).press('Enter');
	await expect(app.page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await app.go('Inbox');
	await app.add('Fix sink #Home p2', 'Water plants tomorrow', 'Call plumber', 'Buy milk', 'Update résumé');
}

test('search-open: search opens with its field focused', async ({ app, snap }) => {
	await openNav(app);
	await nav(app).getByRole('button', { name: 'Search' }).tap();
	await expect(field(app)).toBeFocused();
	await snap('search-open');
});

test('search-match: titles and projects match, every word must, and accents are ignored', async ({ app, snap }) => {
	await seedHome(app);
	await search(app, 'home');
	await expect(group(app, 'Projects').getByRole('option')).toHaveText(['Home']);
	await expect(group(app, 'Tasks').getByRole('option')).toHaveText([/Fix sink/]);
	await snap('search-match');
	await search(app, 'sink home');
	await expect(results(app).getByRole('option')).toHaveText([/Fix sink/]);
	await search(app, 'resume');
	await expect(results(app).getByRole('option')).toHaveText([/Update résumé/]);
});

test('search-highlight: matched spans highlight in names, titles, and label chips', async ({ app, snap }) => {
	await createLabels(app, 'calls', 'waiting');
	await app.add('Plumber @calls', 'Dentist @waiting @calls', 'Read a book');
	await search(app, 'call');
	await expect(group(app, 'Labels').locator('mark')).toHaveText(['call']);
	await expect(group(app, 'Tasks').getByRole('option')).toHaveText([/Dentist.*calls/, /Plumber.*calls/]);
	await expect(group(app, 'Tasks').locator('mark')).toHaveText(['call', 'call']);
	await snap('search-highlight');
	await search(app, 'dentist waiting');
	await expect(group(app, 'Tasks').getByRole('option')).toHaveText([/Dentist/]);
});

test('search-keyboard: Enter opens the selected result', async ({ app, page, snap }) => {
	await seedHome(app);
	await search(app, 'hom');
	await expect(option(app, 'Home')).toHaveAttribute('aria-selected', 'true');
	await snap('search-keyboard');
	await field(app).press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await expect(app.row('Fix sink')).toBeVisible();
});

test('search-open-result: a project navigates and a task opens details', async ({ app, page, snap }) => {
	await seedHome(app);
	await search(app, 'home');
	await option(app, 'Home').tap();
	await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await expect(field(app)).toBeHidden();
	await expect(app.row('Fix sink')).toBeVisible();
	await search(app, 'home');
	await option(app, /Fix sink/).tap();
	await expect(app.details()).toBeVisible();
	await snap('search-open-result');
});

test('search-completed: completed tasks list apart and reopen', async ({ app, snap }) => {
	await app.add('Renew passport', 'Passport photos');
	await app.checkbox('Renew passport').tap();
	await expect(app.row('Renew passport')).toHaveCount(0);
	await search(app, 'passport');
	await expect(group(app, 'Tasks').getByRole('option')).toHaveText([/Passport photos/]);
	await expect(group(app, 'Completed').getByRole('option')).toHaveText([/Renew passport\s*Completed Today/]);
	await snap('search-completed');
	await group(app, 'Completed').getByRole('option').tap();
	await app.details().getByRole('button', { name: 'Reopen' }).tap();
	await app.details().getByRole('button', { name: 'Close' }).tap();
	await expect(app.list('Inbox tasks').getByRole('listitem')).toHaveText([/Renew passport/, /Passport photos/]);
});

test('search-empty: a miss says so', async ({ app, snap }) => {
	await app.add('Fix sink');
	await search(app, 'sink garden');
	await expect(results(app)).toHaveText('No results for “sink garden”');
	await snap('search-empty');
});

test('labels-search: a label result opens the label view', async ({ app, page, snap }) => {
	await createLabels(app, 'calls', 'waiting');
	await app.add('Plumber @calls', 'Dentist @waiting @calls', 'Read a book');
	await search(app, 'wait');
	await option(app, 'waiting').tap();
	await expect(page.getByRole('heading', { level: 1, name: 'waiting' })).toBeVisible();
	await expect(app.row('Dentist')).toBeVisible();
	await expect(app.row('Plumber')).toHaveCount(0);
	await snap('labels-search');
});
