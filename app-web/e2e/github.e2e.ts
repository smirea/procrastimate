import { expect, test } from './fixtures';

const PR = 'https://github.com/smirea/procrastimate/pull/309';

test('a pasted pull request link attaches it to the task, shows its live title and state, opens GitHub in a new tab, and comes off again', async ({
	app,
	page,
}) => {
	const asked: string[] = [];
	await page.route('**/api/github?*', async route => {
		asked.push(new URL(route.request().url()).searchParams.get('url')!);
		await route.fulfill({ json: { title: 'Keep the speaker’s words in titles', state: 'merged', kind: 'pull' } });
	});

	await app.add('Review the ramble fix');
	await app.row('Review the ramble fix').getByRole('button', { name: 'Review the ramble fix', exact: true }).click();
	const details = app.details();
	await details.getByRole('button', { name: 'Add a GitHub issue or pull request' }).click();
	const panel = page.getByRole('dialog', { name: 'GitHub' });
	const field = panel.getByRole('textbox', { name: 'GitHub issue or pull request link' });
	await field.fill('https://github.com/smirea');
	await expect(panel.getByRole('status')).toHaveText('Not an issue or pull request link');
	await field.fill(`${PR}/files`);
	await expect(panel.getByRole('status')).toHaveText('Enter attaches procrastimate#309');
	await field.press('Enter');
	await expect(panel).toBeHidden();

	const link = details.getByRole('link', {
		name: 'Pull request procrastimate#309, Keep the speaker’s words in titles, Merged',
	});
	await expect(link).toHaveAttribute('href', PR);
	await expect(link).toHaveAttribute('target', '_blank');
	expect(asked).toEqual([PR]);
	await expect(app.row('Review the ramble fix').getByRole('img', { name: 'GitHub procrastimate#309' })).toHaveText(
		'#309',
	);
	await app.settle();
	await page.screenshot({ path: 'test-results/github/details.png' });

	const popup = page.waitForEvent('popup');
	await link.click();
	expect((await popup).url()).toContain('github.com/smirea/procrastimate/pull/309');
	await (await popup).close();

	await app.reload();
	await app.row('Review the ramble fix').getByRole('button', { name: 'Review the ramble fix', exact: true }).click();
	await expect(details.getByRole('link', { name: /procrastimate#309/ })).toBeVisible();
	await details.getByRole('button', { name: 'Remove procrastimate#309' }).click();
	await expect(details.getByRole('link', { name: /procrastimate#309/ })).toHaveCount(0);
	await expect(app.row('Review the ramble fix').getByRole('img', { name: /GitHub/ })).toHaveCount(0);
});

test('an attached issue GitHub cannot read shows its repo and number', async ({ app, page }) => {
	await page.route('**/api/github?*', route => route.fulfill({ json: { title: null, state: null, kind: 'issue' } }));
	await app.add('Look into it');
	await app.row('Look into it').getByRole('button', { name: 'Look into it', exact: true }).click();
	const details = app.details();
	await details.getByRole('button', { name: 'Add a GitHub issue or pull request' }).click();
	await page.getByRole('textbox', { name: 'GitHub issue or pull request link' }).fill('smirea/nudge#4');
	await page.getByRole('textbox', { name: 'GitHub issue or pull request link' }).press('Enter');
	const link = details.getByRole('link', { name: 'Issue nudge#4' });
	await expect(link).toHaveText('nudge#4');
	await expect(link).toHaveAttribute('href', 'https://github.com/smirea/nudge/issues/4');
});
