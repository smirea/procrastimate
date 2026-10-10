import { expect, test } from './fixtures.ts';

test('shell-launch: the app opens on an empty Inbox', async ({ app, snap }) => {
	await expect(app.page).toHaveURL(/\/inbox$/);
	await expect(app.page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(app.page.getByText('Inbox zero')).toBeVisible();
	await snap('shell-launch');
});
