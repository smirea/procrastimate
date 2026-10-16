import type { Page } from '@playwright/test';
import { App, expect, test } from './fixtures.ts';

/**
 * Every view, sheet, and dialog at desktop and phone widths, with the phone's on-screen keyboard emulated through the
 * `--keyboard-inset` the app publishes from the visual viewport. Each screen must let its last content scroll fully into
 * view, clear of the floating add button and the keyboard, with nothing clipped out of reach.
 */

const KEYBOARD = 336;
const shots = process.env.LAYOUT_SHOTS;

type Finding = { screen: string; problem: string };

/** Problems on the current screen: clipped scroll areas, sheets off screen, and the end of each scroller hidden. */
function audit(page: Page, keyboard: number) {
	return page.evaluate(async keyboard => {
		const problems: string[] = [];
		const visibleBottom = innerHeight - keyboard;
		const name = (el: Element) =>
			el.getAttribute('aria-label') ??
			el.getAttribute('data-task') ??
			`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')}`;
		const floating = [...document.querySelectorAll<HTMLElement>('.fab, .floating')].map(el =>
			el.getBoundingClientRect(),
		);
		const covered = (rect: DOMRect) =>
			rect.bottom > visibleBottom + 1 ||
			floating.some(f => rect.bottom > f.top + 1 && rect.top < f.bottom && rect.right > f.left && rect.left < f.right);

		for (const el of document.querySelectorAll<HTMLElement>('body *')) {
			const style = getComputedStyle(el);
			if (style.display === 'none' || style.visibility === 'hidden') continue;
			const clips = style.overflowY === 'hidden' || style.overflowY === 'clip';
			if (
				clips &&
				el.clientHeight > 48 &&
				el.scrollHeight - el.clientHeight > 4 &&
				!el.closest('[aria-hidden="true"]')
			) {
				problems.push(`${name(el)} clips ${el.scrollHeight - el.clientHeight}px it cannot scroll to`);
			}
		}

		for (const sheet of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
			const rect = sheet.getBoundingClientRect();
			if (rect.top < -1 || rect.bottom > visibleBottom + 1) {
				problems.push(`${name(sheet)} spans ${Math.round(rect.top)} to ${Math.round(rect.bottom)} of ${visibleBottom}`);
			}
		}

		const scrollers = [
			document.scrollingElement as HTMLElement,
			...document.querySelectorAll<HTMLElement>('body *'),
		].filter(el => {
			if (el === document.scrollingElement)
				return !document.querySelector('[role="dialog"]') && el.scrollHeight > innerHeight + 1;
			const style = getComputedStyle(el);
			return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
		});
		for (const scroller of scrollers) {
			scroller.scrollTop = scroller.scrollHeight;
			await new Promise(requestAnimationFrame);
			const items = [
				...scroller.querySelectorAll<HTMLElement>('button, a, input, textarea, [data-task], p, li'),
			].filter(el => {
				const rect = el.getBoundingClientRect();
				return rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.fab, .floating');
			});
			const last = items.reduce<HTMLElement | undefined>(
				(lowest, el) =>
					!lowest || el.getBoundingClientRect().bottom > lowest.getBoundingClientRect().bottom ? el : lowest,
				undefined,
			);
			if (!last) continue;
			const rect = last.getBoundingClientRect();
			const frame = scroller === document.scrollingElement ? { bottom: innerHeight } : scroller.getBoundingClientRect();
			if (rect.bottom > frame.bottom + 1 || covered(rect)) {
				problems.push(
					`end of ${name(scroller)} (${name(last)}) sits at ${Math.round(rect.bottom)}, hidden behind ${rect.bottom > visibleBottom ? 'the keyboard or the screen edge' : 'the add button'}`,
				);
			}
		}
		scrollTo(0, 0);
		return problems;
	}, keyboard);
}

async function check(page: Page, findings: Finding[], screen: string, keyboard = 0) {
	await page.evaluate(inset => document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`), keyboard);
	await page.waitForTimeout(350);
	for (const problem of await audit(page, keyboard)) findings.push({ screen, problem });
	if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${screen}.png` });
}

const LONG_NOTES = Array.from(
	{ length: 30 },
	(_, i) => `Line ${i + 1} of the notes, long enough to wrap on a phone.`,
).join('\n');

async function seed(app: App) {
	await app.createProject('Trip to Lisbon');
	for (let i = 1; i <= 22; i++) await app.add(`Lisbon step ${i} with a longer title so rows wrap on phones`);
	await app.go('Inbox');
	for (let i = 1; i <= 14; i++) await app.add(`Inbox chore ${i} today`);
	for (let i = 1; i <= 10; i++) await app.add(`Someday idea ${i}`);
	await app.add('Write the long notes task tomorrow');
}

for (const [width, height] of [
	[1280, 800],
	[393, 852],
] as const) {
	test(`every screen scrolls clear at ${width}px`, async ({ app, page }) => {
		test.setTimeout(240_000);
		const phone = width < 768;
		const findings: Finding[] = [];
		const prefix = phone ? 'phone' : 'desktop';
		await seed(app);
		await page.setViewportSize({ width, height });
		const open = async (view: string) => {
			if (phone) {
				await page.getByRole('button', { name: 'Open navigation' }).click();
			}
			await app.nav(view).click();
			await expect(page.getByRole('heading', { level: 1, name: view })).toBeVisible();
			await app.settle();
		};

		for (const view of ['Inbox', 'No date', 'Trip to Lisbon']) {
			await open(view);
			await check(page, findings, `${prefix}-${view.replaceAll(' ', '-').toLowerCase()}`);
		}

		await open('Inbox');
		if (phone) await page.getByRole('button', { name: 'Quick add' }).click();
		else await app.openQuickAdd();
		await app.taskInput().fill('Something long enough to wrap across a couple of lines in the field tomorrow');
		await check(page, findings, `${prefix}-quick-add`);
		if (phone) await check(page, findings, `${prefix}-quick-add-keyboard`, KEYBOARD);
		await page.keyboard.press('Escape');
		await expect(app.quickAdd()).toBeHidden();

		await app.row('Write the long notes task').click();
		await expect(app.details()).toBeVisible();
		await app.details().getByRole('textbox', { name: 'Notes' }).fill(LONG_NOTES);
		await check(page, findings, `${prefix}-details`);
		if (phone) {
			await app.details().getByRole('textbox', { name: 'Notes' }).focus();
			await check(page, findings, `${prefix}-details-keyboard`, KEYBOARD);
		}
		await app.details().getByRole('button', { name: 'Close' }).click();
		await expect(app.details()).toBeHidden();

		if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
		await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Search' }).click();
		const search = page.getByRole('dialog', { name: 'Search' });
		await expect(search).toBeVisible();
		await page.keyboard.type('i');
		await check(page, findings, `${prefix}-search`);
		if (phone) await check(page, findings, `${prefix}-search-keyboard`, KEYBOARD);
		await page.keyboard.press('Escape');
		await expect(search).toBeHidden();

		if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
		await app.openSettings();
		await check(page, findings, `${prefix}-settings`);
		const aiName = app.settings().getByRole('textbox').first();
		if (phone && (await aiName.count())) {
			await aiName.focus();
			await check(page, findings, `${prefix}-settings-keyboard`, KEYBOARD);
		}
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press('Escape');
		await expect(app.settings()).toBeHidden();

		await open('Trip to Lisbon');
		await page.getByRole('button', { name: 'Share project' }).click();
		const share = page.getByRole('dialog', { name: 'Share' });
		await expect(share).toBeVisible();
		await check(page, findings, `${prefix}-share`);
		if (phone) await check(page, findings, `${prefix}-share-keyboard`, KEYBOARD);
		await page.keyboard.press('Escape');

		expect(findings).toEqual([]);
	});
}
