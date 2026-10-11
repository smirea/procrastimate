import { expect, test } from './fixtures.ts';

const at = (iso: string) => new Date(iso);

test('reminders-fire: a due reminder shows a toast with Open while the app is open', async ({ app, snap }) => {
	await app.add('Call mom today 10:30am');
	await app.relaunch(at('2026-10-14T10:31:00Z'));
	await expect(app.toast('Reminder: Call mom')).toBeVisible();
	await snap('reminders-fire');
	await app.toast('Reminder: Call mom').getByRole('button', { name: 'Open' }).tap();
	await expect(app.details()).toBeVisible();
});

test('reminders-due-time: the due time notifies alone, a date alone never does, one per moment', async ({
	app,
	snap,
}) => {
	await app.add(
		'Call mom today 10:30am',
		'Taxes today',
		'Standup today 10:45am remind me at 10:45am',
		'Gym today 11am remind me 30m before',
	);

	await app.relaunch(at('2026-10-14T10:31:00Z'));
	await expect(app.toast('Reminder: Call mom')).toBeVisible();
	await expect(app.toast('Reminder: Gym')).toBeVisible();
	await expect(app.toast('Reminder: Standup')).toHaveCount(0);
	await expect(app.toast('Reminder: Taxes')).toHaveCount(0);
	await snap('reminders-due-time');

	await app.relaunch(at('2026-10-14T10:46:00Z'));
	await expect(app.toast('Reminder: Standup')).toHaveCount(1);
	await expect(app.toast('Reminder: Call mom')).toHaveCount(0);

	await app.relaunch(at('2026-10-14T11:01:00Z'));
	await expect(app.toast('Reminder: Gym')).toHaveCount(1);
	await expect(app.toast('Reminder: Standup')).toHaveCount(0);
	await expect(app.toast('Reminder: Taxes')).toHaveCount(0);
});

test('recurring-reminders: reminders and the due time notify at the next occurrence', async ({ app, snap }) => {
	await app.add('Standup every day 10:30am r10m');
	await app.checkbox('Standup').tap();
	await expect(app.row('Standup')).toContainText('Tomorrow');
	await app.relaunch(at('2026-10-15T10:21:00Z'));
	await expect(app.toast('Reminder: Standup')).toBeVisible();
	await snap('recurring-reminders');
});
