import { expect, test } from './fixtures.ts';
import { chip, closeDetails, menu, openDetails } from './details-fixtures.ts';

test('recurring-display: the repeat icon is named after the repeat', async ({ app, snap }) => {
	await app.add('Standup every mon 9am', 'Water plants every 3 days');
	await expect(app.row('Standup').getByRole('img', { name: 'Repeats every Mon' })).toBeVisible();
	await expect(app.row('Water plants').getByRole('img', { name: 'Repeats every 3 days' })).toBeVisible();
	await snap('recurring-display');
});

test('recurring-picker: presets, weekday toggles that keep it open, a custom interval, and Don’t repeat', async ({
	app,
	snap,
}) => {
	await app.add('Standup fri 9am');
	await openDetails(app, 'Standup');
	await chip(app, 'Set repeat').tap();
	const repeat = menu(app, 'Repeat');
	await expect(repeat.getByRole('button', { name: /^Every / })).toHaveText([
		'Every day',
		'Every weekday',
		'Every Fri',
		'Every month',
		'Every year',
	]);
	await repeat.getByRole('button', { name: 'Every Fri' }).tap();
	await expect(repeat).toBeHidden();
	await expect(chip(app, 'Repeats every Fri')).toBeVisible();

	await chip(app, 'Repeats every Fri').tap();
	await expect(repeat.getByRole('button', { name: 'Fri', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await repeat.getByRole('button', { name: 'Mon', exact: true }).tap();
	await repeat.getByRole('button', { name: 'Wed', exact: true }).tap();
	await expect(repeat.getByRole('button', { name: 'Wed', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(chip(app, 'Repeats every Mon, Wed, Fri')).toBeVisible();
	await snap('recurring-picker');

	await repeat.getByRole('spinbutton', { name: 'Repeat interval' }).fill('3');
	await repeat.getByRole('button', { name: 'Set' }).tap();
	await expect(chip(app, 'Repeats every 3 days')).toBeVisible();

	await chip(app, 'Repeats every 3 days').tap();
	await repeat.getByRole('button', { name: 'Don’t repeat' }).tap();
	await expect(chip(app, 'Set repeat')).toBeVisible();
	await closeDetails(app);
	await expect(app.row('Standup')).toContainText('Friday 9am');
});
