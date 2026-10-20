import type { Page } from '@playwright/test';
import type { Task } from '../../shared/task.ts';
import { project, task } from '../../shared/testing.ts';
import { App, expect, NOW, test } from './fixtures.ts';

/**
 * Every view, sheet, and dialog at desktop and phone widths, with the phone's on-screen keyboard emulated through the
 * `--keyboard-inset` the app publishes from the visual viewport. Each screen must let its last content scroll fully into
 * view, clear of the floating add button and the keyboard, with nothing clipped out of reach.
 */

const KEYBOARD = 336;

test.use({
	permissions: ['microphone'],
	launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

/** The page never names a Ramble cassette, so the socket URL gets one here. */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const Native = window.WebSocket;
		window.WebSocket = class extends Native {
			constructor(url: string | URL, protocols?: string | string[]) {
				const next = new URL(url, location.href);
				if (next.pathname === '/api/ramble/socket') next.searchParams.set('cassette', 'party');
				super(next, protocols);
			}
		};
	});
});
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
			// Instant, since a smooth scroll would still be on its way one frame later.
			scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
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

/** Waits for the animations an inset change starts, the way `App.settle` does, since the audit has only the page. */
async function settled(page: Page) {
	await page.evaluate(async () => {
		const running = () => document.getAnimations().filter(animation => animation.playState === 'running');
		for (let busy = running(); busy.length; busy = running()) {
			await Promise.race(busy.map(animation => animation.finished.catch(() => {})));
		}
	});
}

async function check(page: Page, findings: Finding[], screen: string, keyboard = 0) {
	await page.evaluate(inset => document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`), keyboard);
	await settled(page);
	for (const problem of await audit(page, keyboard)) findings.push({ screen, problem });
	if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${screen}.png` });
}

const LONG_NOTES = Array.from(
	{ length: 30 },
	(_, i) => `Line ${i + 1} of the notes, long enough to wrap on a phone.`,
).join('\n');

/** Seeded through the API rather than typed, since the audit is about the screens and 47 quick adds took a minute. */
async function seed(app: App) {
	const lisbon = crypto.randomUUID();
	let createdAt = NOW.getTime();
	const row = (title: string, fields: Partial<Task> = {}) => ({
		kind: 'task' as const,
		fields: task(crypto.randomUUID(), { title, createdAt: createdAt++, ...fields }),
	});
	await app.seed(
		{ kind: 'project', fields: project(lisbon, { name: 'Trip to Lisbon', createdAt: createdAt++ }) },
		...Array.from({ length: 22 }, (_, i) =>
			row(`Lisbon step ${i + 1} with a longer title so rows wrap on phones`, { projectId: lisbon }),
		),
		...Array.from({ length: 14 }, (_, i) => row(`Inbox chore ${i + 1}`, { due: { date: '2026-10-14', time: null } })),
		...Array.from({ length: 10 }, (_, i) => row(`Someday idea ${i + 1}`)),
		row('Write the long notes task', { due: { date: '2026-10-15', time: null } }),
	);
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
			const heading = page.getByRole('heading', { level: 1, name: view });
			// Clicking the link of the view already showing would leave a phone's drawer open over it.
			if (!(await heading.isVisible())) {
				if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
				await app.nav(view).click();
			}
			await expect(heading).toBeVisible();
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
		await (await app.listMenu()).getByRole('button', { name: 'Share' }).click();
		const share = page.getByRole('dialog', { name: 'Share' });
		await expect(share).toBeVisible();
		await check(page, findings, `${prefix}-share`);
		if (phone) await check(page, findings, `${prefix}-share-keyboard`, KEYBOARD);
		await page.keyboard.press('Escape');
		await expect(share).toBeHidden();

		await open('Inbox');
		for (let i = 1; i <= 10; i++)
			await page.getByRole('checkbox', { name: `Complete Inbox chore ${i}`, exact: true }).click();
		await open('Completed');
		await check(page, findings, `${prefix}-completed`);

		if (phone) await page.getByRole('button', { name: 'Open navigation' }).click();
		await app.openSettings();
		await app.dictationOption('ElevenLabs').click();
		await page.keyboard.press('Escape');
		await expect(app.settings()).toBeHidden();
		if (phone) await page.getByRole('button', { name: 'Quick add' }).click();
		else await app.openQuickAdd();
		await app.quickAdd().getByRole('button', { name: 'Ramble' }).click();
		const drawer = page.getByRole('dialog', { name: 'Ramble' });
		await expect(drawer.getByText('Renew the passport', { exact: true })).toBeVisible({ timeout: 15_000 });
		await drawer.getByRole('button', { name: 'Stop listening' }).click();
		await expect(drawer.getByRole('button', { name: /^Add \d+ tasks$/ })).toBeVisible();
		await check(page, findings, `${prefix}-ramble`);
		if (phone) {
			await drawer.getByRole('textbox', { name: 'Task title', exact: true }).first().focus();
			await check(page, findings, `${prefix}-ramble-keyboard`, KEYBOARD);
		}

		expect(findings).toEqual([]);
	});
}
