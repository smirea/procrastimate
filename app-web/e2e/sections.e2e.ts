import type { DateKey } from '../../shared/task.ts';
import { project, section, task } from '../../shared/testing.ts';
import { NOW, deviceContext, expect, test } from './fixtures';

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
	await expect(page.getByRole('list', { name: 'Later tasks' }).locator('[data-task="Fix fence"]')).toBeAttached();
	await app.closeQuickAdd();
	await app.settle();

	await app.openQuickAdd();
	await app.taskInput().fill('Paint door #Home /next');
	await expect(app.quickAdd().getByRole('listbox')).toContainText('Next up');
	await app.settle();
	await page.screenshot({ path: 'test-results/sections/quick-add.png' });
	await app.taskInput().press('Tab');
	await expect(app.taskInput()).toHaveValue('Paint door #Home /Next up ');
	await app.taskInput().press('Enter');
	await app.closeQuickAdd();
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
	await page.getByRole('button', { name: 'Next up', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Section actions' })).toContainText(/^Next up/);
	await app.settle();
	await page.screenshot({ path: 'test-results/sections/menu.png' });
	await page.getByRole('button', { name: 'Move up' }).click();
	await app.settle();
	await expect(sectionHeadings()).toHaveText([/^Next up/, /^Later/]);

	await page.getByRole('button', { name: 'Later', exact: true }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	const name = page.getByRole('textbox', { name: 'Section name' });
	await name.fill('Dropped');
	await name.press('Escape');
	await expect(page.getByRole('region', { name: 'Later' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Dropped' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Later', exact: true }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	await name.fill('Someday');
	await name.press('Enter');
	await expect(page.getByRole('region', { name: 'Someday' })).toBeVisible();

	await app.reload();
	await expect(sectionHeadings()).toHaveText([/^Next up/, /^Someday/]);

	await page.getByRole('button', { name: 'Someday', exact: true }).click();
	await page.getByRole('button', { name: 'Delete section' }).click();
	await expect(page.getByText('Delete Someday and its 1 task?')).toBeVisible();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByRole('region', { name: 'Someday' })).toHaveCount(0);
	await expect(app.row('Fix fence')).toHaveCount(0);
	await expect(app.row('Paint door')).toBeVisible();
});

test('a section can show a pending count badge: due tasks like the Inbox badge, else every open task in the accent', async ({
	app,
	page,
	browser,
}) => {
	const home = crypto.randomUUID();
	const errands = crypto.randomUUID();
	let createdAt = NOW.getTime();
	const row = (title: string, due: DateKey | null = null) => ({
		kind: 'task' as const,
		fields: task(crypto.randomUUID(), {
			title,
			projectId: home,
			sectionId: errands,
			due: due ? { date: due, time: null } : null,
			createdAt: createdAt++,
		}),
	});
	await app.seed(
		{ kind: 'project', fields: project(home, { name: 'Home', createdAt: createdAt++ }) },
		{ kind: 'section', fields: section(errands, home, { name: 'Errands', createdAt: createdAt++ }) },
		row('Post the parcel', '2026-10-14'),
		row('Buy stamps', '2026-10-20'),
		row('Return the drill'),
	);
	await app.nav('Home').click();
	const region = page.getByRole('region', { name: 'Errands' });
	await expect(region.locator('[data-badge]')).toHaveCount(0);

	await page.getByRole('button', { name: 'Errands', exact: true }).click();
	const toggle = page.getByRole('menuitemcheckbox', { name: 'Show pending count' });
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await toggle.click();
	const badge = region.locator('[data-badge]');
	await expect(badge).toHaveAttribute('data-badge', 'due');
	await expect(badge).toHaveText('1 due or overdue');
	await app.settle();
	await page.screenshot({ path: 'test-results/sections/badge-due.png' });

	await app.row('Post the parcel').getByRole('checkbox', { name: 'Complete Post the parcel' }).click();
	await expect(badge).toHaveAttribute('data-badge', 'pending');
	await expect(badge).toHaveText('2 open');
	await app.settle();
	await page.screenshot({ path: 'test-results/sections/badge-pending.png' });

	await app.reload();
	await expect(page.getByRole('region', { name: 'Errands' }).locator('[data-badge]')).toHaveText('2 open');

	await (await app.listMenu()).getByRole('button', { name: 'Share' }).click();
	const sheet = page.getByRole('dialog', { name: 'Share' });
	await sheet.getByRole('button', { name: 'Copy link' }).click();
	await expect(sheet.getByLabel('Link')).toHaveText(/\/s\/.+/);
	const link = new URL((await sheet.getByLabel('Link').textContent())!);
	const visitor = await (await deviceContext(browser)).newPage();
	await visitor.clock.setFixedTime(NOW);
	await visitor.goto(link.pathname);
	await expect(visitor.locator('[data-badge]')).toHaveText('2 open', { timeout: 15_000 });
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);

	await page.getByRole('button', { name: 'Errands', exact: true }).click();
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await toggle.click();
	await expect(page.getByRole('region', { name: 'Errands' }).locator('[data-badge]')).toHaveCount(0);
});
