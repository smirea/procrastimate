import { expect, NOW, test } from './fixtures';

test('a push service that refuses to subscribe is asked again a day later, not on every load', async ({ app }) => {
	const { page } = app;
	await page.addInitScript(() => {
		const count = () => Number(localStorage.getItem('test-subscribe-attempts'));
		const pushManager = {
			getSubscription: async () => null,
			subscribe: async () => {
				localStorage.setItem('test-subscribe-attempts', String(count() + 1));
				throw new DOMException('Registration failed - push service error', 'AbortError');
			},
		};
		const registration = { pushManager };
		Object.defineProperty(navigator, 'serviceWorker', {
			value: {
				register: async () => registration,
				getRegistration: async () => registration,
				ready: Promise.resolve(registration),
				addEventListener() {},
				removeEventListener() {},
			},
		});
		Object.assign(window, { PushManager: class {} });
		Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
	});
	const attempts = () => page.evaluate(() => Number(localStorage.getItem('test-subscribe-attempts')));

	await page.reload();
	await expect.poll(attempts).toBe(1);
	await page.reload();
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
	expect(await attempts()).toBe(1);

	const dayAgo = NOW.getTime() - 25 * 60 * 60 * 1000;
	await page.evaluate(at => localStorage.setItem('procrastimate-push-refused-at', String(at)), dayAgo);
	await page.reload();
	await expect.poll(attempts).toBe(2);
});
