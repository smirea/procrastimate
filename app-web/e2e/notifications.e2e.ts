import { expect, test } from './fixtures';

test('tasks due at the same moment show one notification that opens their project', async ({ app, page }) => {
	await app.addCreating('Pack #Trip tomorrow 9am');
	await app.add('Charge phone #Trip tomorrow 9am', 'Call mom tomorrow 9:30am');
	await page.addInitScript(() => {
		const shown: { text: string; click: () => void }[] = [];
		Object.assign(window, { shownNotifications: shown });
		// Without push the open app shows the system notification itself.
		delete (window as { PushManager?: unknown }).PushManager;
		window.Notification = class {
			static permission = 'granted';
			static requestPermission = async () => 'granted';
			onclick: (() => void) | null = null;
			constructor(title: string, options?: NotificationOptions) {
				shown.push({ text: `${title}: ${options?.body}`, click: () => this.onclick?.() });
			}
		} as unknown as typeof Notification;
	});
	type Shown = { shownNotifications: { text: string; click: () => void }[] };
	await app.setNow(new Date('2026-10-15T09:00:30Z'));
	await app.reload();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as Shown).shownNotifications.map(n => n.text)))
		.toEqual(['2 tasks: Pack, Charge phone']);
	await page.evaluate(() => (window as unknown as Shown).shownNotifications[0]?.click());
	await expect(page).toHaveURL(/\/projects\//);
	await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible();
});
