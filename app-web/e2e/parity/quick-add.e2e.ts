import { expect, test } from './fixtures.ts';

test('add-open: the add button opens quick add with focus in the field', async ({ app, snap }) => {
	await app.openQuickAdd();
	await expect(app.quickAdd().getByRole('button', { name: 'Set due date' })).toBeVisible();
	await expect(app.quickAdd().getByRole('button', { name: 'Add task' })).toBeDisabled();
	await snap('add-open');
});

test('add-save: a saved task lands in the current list', async ({ app, snap }) => {
	await app.add('Buy milk');
	await expect(app.row('Buy milk')).toBeVisible();
	await snap('add-save');
});

test('add-due: a typed due date leaves the title', async ({ app, snap }) => {
	await app.add('Call mom tomorrow');
	await expect(app.row('Call mom')).toContainText('Tomorrow');
	await expect(app.row('Call mom tomorrow')).toHaveCount(0);
	await snap('add-due');
});

test('add-shorthand: shorthands parse while names stay text', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('Call Tom about the sun hat tom 5p r30m');
	await expect(app.highlight('due')).toHaveText('tom 5p');
	await expect(app.highlight('reminder')).toHaveText('r30m');
	await expect(app.quickAdd().locator('[data-token]')).toHaveCount(2);
	await expect(app.quickAdd().getByRole('button', { name: 'Due Tomorrow 5pm' })).toBeVisible();
	await expect(app.quickAdd().getByText('30m before', { exact: true })).toBeVisible();
	await snap('add-shorthand');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Call Tom about the sun hat')).toContainText('Tomorrow 5pm');
});

test('add-recurrence: a repeat parses into a chip and onto the row', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('Standup every mon 9:30a');
	await expect(app.highlight('recurrence')).toHaveText('every mon');
	await expect(app.highlight('due')).toHaveText('9:30a');
	await expect(app.quickAdd().getByText('Every Mon', { exact: true })).toBeVisible();
	await expect(app.quickAdd().getByRole('button', { name: 'Due Monday 9:30am' })).toBeVisible();
	await snap('add-recurrence');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Standup')).toContainText('Monday 9:30am');
	await expect(app.row('Standup').getByRole('img', { name: 'Repeats every Mon' })).toBeVisible();
});

test('add-highlight: each parsed phrase is highlighted', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('call mom tomorrow 5pm remind me 30m before p1');
	await expect(app.highlight('due')).toHaveText('tomorrow 5pm');
	await expect(app.highlight('reminder')).toHaveText('remind me 30m before');
	await expect(app.highlight('priority')).toHaveText('p1');
	await snap('add-highlight');
});

test('add-config-row: the chips spell out due, repeat, and reminders', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('Gym every mon 7am r15m p2');
	const quickAdd = app.quickAdd();
	await expect(quickAdd.getByRole('button', { name: 'Due Monday 7am' })).toBeVisible();
	await expect(quickAdd.getByText('Every Mon', { exact: true })).toBeVisible();
	await expect(quickAdd.getByText('15m before', { exact: true })).toBeVisible();
	await expect(quickAdd.getByRole('button', { name: 'Priority 2' })).toBeVisible();
	await snap('add-config-row');
});

test('add-keep-text: Keep as text un-parses a phrase', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('Read Monday Night Club');
	await expect(app.highlight('due')).toHaveText('Monday');
	await app.quickAdd().getByRole('button', { name: 'Keep as text' }).first().tap();
	await expect(app.quickAdd().locator('[data-token]')).toHaveCount(0);
	await expect(app.quickAdd().getByRole('button', { name: 'Set due date' })).toBeVisible();
	await snap('add-keep-text');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Read Monday Night Club')).toBeVisible();
	await expect(app.row('Read Monday Night Club')).not.toContainText('Monday,');
});

test('add-defaults: quick add inside Today defaults the date to today', async ({ app, snap }) => {
	await app.go('Today');
	await app.openQuickAdd();
	await expect(app.quickAdd().getByRole('button', { name: 'Due Today' })).toBeVisible();
	await snap('add-defaults');
	await app.taskInput().fill('Stretch');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Stretch')).toBeVisible();
});

test('add-cancel: dismissing discards the draft', async ({ app, page, snap }) => {
	await app.openQuickAdd();
	await app.type('Discard me');
	await app.cancelQuickAdd();
	await expect(app.row('Discard me')).toHaveCount(0);
	await expect(page.getByText('Inbox zero')).toBeVisible();
	await snap('add-cancel');
	await app.openQuickAdd();
	await expect(app.taskInput()).toHaveValue('');
});

test('add-repeat: quick add stays open for the next task', async ({ app, snap }) => {
	await app.openQuickAdd();
	for (const title of ['Buy milk', 'Pay rent']) {
		await app.taskInput().fill(title);
		await app.taskInput().press('Enter');
		await expect(app.taskInput()).toHaveValue('');
	}
	await expect(app.quickAdd()).toBeVisible();
	await expect(app.row('Buy milk')).toBeVisible();
	await expect(app.row('Pay rent')).toBeVisible();
	await snap('add-repeat');
});

test('reminders-nl: a typed reminder becomes a chip and shows on the row', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('Call mom tomorrow 5pm remind me 30m before');
	await expect(app.highlight('reminder')).toHaveText('remind me 30m before');
	await expect(app.quickAdd().getByText('30m before', { exact: true })).toBeVisible();
	await snap('reminders-nl');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Call mom').getByLabel('1 reminders')).toBeVisible();
});

test('projects-assign: #Name puts the task in that project', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('#Errands');
	await app.quickAdd().getByRole('option', { name: 'Create project “Errands”' }).tap();
	await app.type('Pay rent today');
	await expect(app.highlight('project')).toHaveText('#Errands');
	await expect(app.quickAdd().getByRole('button', { name: 'Project Errands' })).toBeVisible();
	await snap('projects-assign');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Pay rent')).toHaveCount(0);
	await app.go('Today');
	await expect(app.row('Pay rent')).toContainText('Errands');
});

test('projects-autocomplete: # suggests projects by match and use, then offers to create', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('#Errands');
	await app.quickAdd().getByRole('option', { name: 'Create project “Errands”' }).tap();
	await app.type('Buy milk');
	await app.taskInput().press('Enter');
	await app.type('#Home');
	await app.quickAdd().getByRole('option', { name: 'Create project “Home”' }).tap();
	await app.type('Fix sink');
	await app.taskInput().press('Enter');
	await app.type('#e');
	const list = app.quickAdd().getByRole('listbox', { name: 'Projects' });
	await expect(list.getByRole('option')).toHaveText(['Errands', 'Home', 'Create project “e”']);
	await snap('projects-autocomplete');
	await list.getByRole('option', { name: 'Home' }).tap();
	await expect(app.taskInput()).toHaveValue('#Home ');
});

test('labels-type: @name adds a label while emails stay text', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('@calls');
	await app.quickAdd().getByRole('option', { name: 'Create label “calls”' }).tap();
	await app.type('Ping ana@example.com');
	await expect(app.highlight('label')).toHaveText('@calls');
	await expect(app.quickAdd().locator('[data-token]')).toHaveCount(1);
	await snap('labels-type');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Ping ana@example.com')).toContainText('calls');
});

test('labels-autocomplete: @ suggests labels and offers to create one', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('@ca');
	const list = app.quickAdd().getByRole('listbox', { name: 'Labels' });
	await expect(list.getByRole('option', { name: 'Create label “ca”' })).toBeVisible();
	await app.type('lls');
	await list.getByRole('option', { name: 'Create label “calls”' }).tap();
	await expect(app.taskInput()).toHaveValue('@calls ');
	await app.type('Ping Ana');
	await app.taskInput().press('Enter');
	await app.type('@c');
	await expect(list.getByRole('option', { name: 'calls' })).toBeVisible();
	await snap('labels-autocomplete');
});

test('labels-keep-text: Keep as text on a label chip keeps @name in the title', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('@calls');
	await app.quickAdd().getByRole('option', { name: 'Create label “calls”' }).tap();
	await app.type('Ping Ana');
	await app.taskInput().press('Enter');
	await app.type('Ping @calls');
	await expect(app.highlight('label')).toHaveText('@calls');
	await app.quickAdd().getByRole('button', { name: 'Keep as text' }).first().tap();
	await expect(app.quickAdd().locator('[data-token]')).toHaveCount(0);
	await snap('labels-keep-text');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Ping @calls')).toBeVisible();
});

test('add-create: an unknown #project or @label offers to create it and never creates it silently', async ({
	app,
	snap,
}) => {
	await app.openQuickAdd();
	await app.type('Call @dentist now');
	await expect(app.quickAdd().getByRole('button', { name: 'Create @dentist' })).toBeVisible();
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
	await app.type('Buy milk #Personal @phone today');
	const createProject = app.quickAdd().getByRole('button', { name: 'Create #Personal' });
	const createLabel = app.quickAdd().getByRole('button', { name: 'Create @phone' });
	await expect(createProject).toBeVisible();
	await expect(createLabel).toBeVisible();
	await createProject.tap();
	await expect(app.highlight('project')).toHaveText('#Personal');
	await expect(createProject).toHaveCount(0);
	await createLabel.tap();
	await expect(app.highlight('label')).toHaveText('@phone');
	await expect(createLabel).toHaveCount(0);
	await snap('add-create');
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
	await app.cancelQuickAdd();
	await expect(app.row('Call @dentist now')).toBeVisible();
	await app.go('Today');
	await expect(app.row('Buy milk')).toContainText('Personal');
	await expect(app.row('Buy milk')).toContainText('phone');
});

test('add-dock: quick add docks to the bottom edge and hides the add button', async ({ app, page, snap }) => {
	await app.openQuickAdd();
	await expect(page.getByRole('button', { name: 'Quick add' })).toHaveCount(0);
	await app.settle();
	const box = (await app.quickAdd().boundingBox())!;
	expect(page.viewportSize()!.height - (box.y + box.height)).toBeLessThanOrEqual(12);
	await snap('add-dock');
	await app.cancelQuickAdd();
	await expect(page.getByRole('button', { name: 'Quick add' })).toBeVisible();
});

test('add-toast: a toast over quick add sits clear of its chips with its text in full', async ({ app, page, snap }) => {
	await app.openQuickAdd();
	await app.type('Call mom tomorrow 5pm every mon r30m');
	await app.taskInput().press('Enter');
	await app.type('Call mom tomorrow 5pm every mon r30m');
	const toast = page.getByRole('status').filter({ hasText: 'Get notified when it’s due?' });
	await expect(toast).toBeVisible();
	await app.settle();
	const message = toast.getByText('Get notified when it’s due?');
	expect(await message.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
	const button = (await toast.getByRole('button', { name: 'Turn on' }).boundingBox())!;
	expect(button.height).toBeLessThanOrEqual(44);
	const toastBox = (await toast.boundingBox())!;
	for (const chip of [
		app.quickAdd().getByRole('button', { name: 'Add reminder' }),
		app.quickAdd().getByText('Every').first(),
	]) {
		const box = (await chip.boundingBox())!;
		expect(toastBox.y + toastBox.height <= box.y || box.y + box.height <= toastBox.y).toBe(true);
	}
	await snap('add-toast');
});
