import { expect, test } from './fixtures.ts';

test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

test('a pinch and a double tap leave the page at its own size on a phone', async ({ app: _, page }) => {
	const cdp = await page.context().newCDPSession(page);
	const scale = () => page.evaluate(() => window.visualViewport!.scale);

	await cdp.send('Input.synthesizePinchGesture', { x: 196, y: 400, scaleFactor: 2.5, relativeSpeed: 400 });
	await page.waitForTimeout(300);
	expect(await scale()).toBe(1);

	await cdp.send('Input.synthesizeTapGesture', { x: 196, y: 600, tapCount: 2 });
	await page.waitForTimeout(500);
	expect(await scale()).toBe(1);
});
