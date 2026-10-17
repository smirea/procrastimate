import { chromium, webkit, type Browser, type Page } from 'playwright';

const URL = process.env.WEB ?? 'http://127.0.0.1:58083';
type Poc = Record<string, (...args: any[]) => Promise<any>>;
const call = (page: Page, name: string, ...args: unknown[]) =>
	page.evaluate(([n, a]) => ((window as any).poc as Poc)[n as string](...(a as unknown[])), [name, args] as const);

async function open(browser: Browser, db: string) {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on('pageerror', error => console.log('pageerror', db, error.message));
	await page.goto(`${URL}/?db=${db}`);
	await page.waitForFunction(() => (window as any).poc);
	return page;
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000) {
	const start = Date.now();
	for (;;) {
		const v = await fn();
		if (ok(v)) return v;
		if (Date.now() - start > ms) throw new Error(`timed out: ${JSON.stringify(v)}`);
		await new Promise(r => setTimeout(r, 20));
	}
}

async function run(name: string, launch: () => Promise<Browser>) {
	const browser = await launch();
	const stamp = Date.now();
	const a = await open(browser, `a${stamp}`);
	const b = await open(browser, `b${stamp}`);
	const g = await open(browser, `g${stamp}`);
	const owner = await call(a, 'signUp', `o${stamp}${name}@x.test`);
	await call(b, 'signIn', `o${stamp}${name}@x.test`);
	const guest = await call(g, 'signUp', `g${stamp}${name}@x.test`);
	for (const page of [a, b, g]) await call(page, 'connect');

	const latencies: number[] = [];
	for (let i = 0; i < 5; i++) {
		const { id, at } = await call(a, 'add', `task ${i}`);
		const seen = await waitFor(
			() => call(b, 'seenAt', id, `task ${i}`),
			v => v !== null,
		);
		latencies.push(Math.round(seen - at));
	}
	const rows = await call(b, 'list');
	const first = rows.find((r: any) => r.title === 'task 0');
	const jsonOk =
		Array.isArray(first.labelIds) &&
		first.labelIds.length === 2 &&
		first.due?.date === '2026-10-20' &&
		first.createdBy === owner;

	const renameAt = await call(b, 'rename', first.id, 'renamed');
	const renameSeen = await waitFor(
		() => call(a, 'seenAt', first.id, 'renamed'),
		v => v !== null,
	);

	await call(a, 'share', first.id, guest, 'view');
	await waitFor(
		() => call(g, 'list'),
		v => v.length === 1,
	);
	await call(g, 'rename', first.id, 'guest edit');
	await waitFor(
		() => call(g, 'rejections'),
		v => v.length === 1,
	);
	const reverted = await waitFor(
		() => call(g, 'list'),
		v => v[0]?.title === 'renamed',
	);
	await call(a, 'share', first.id, guest, 'edit');
	await waitFor(
		() => call(g, 'access'),
		v => v[0]?.role === 'edit',
	);
	await call(g, 'rename', first.id, 'guest edit 2');
	await waitFor(
		() => call(a, 'list'),
		v => v.some((r: any) => r.title === 'guest edit 2'),
	);
	await call(a, 'share', first.id, guest, null);
	await waitFor(
		() => call(g, 'list'),
		v => v.length === 0,
	);

	await call(a, 'remove', first.id);
	await waitFor(
		() => call(b, 'list'),
		v => !v.some((r: any) => r.id === first.id),
	);
	console.log(
		JSON.stringify({
			browser: name,
			latencyMs: latencies,
			uploads: (await call(a, 'uploads')).slice(0, 5),
			renameMs: Math.round(renameSeen - renameAt),
			jsonOk,
			guestViewEditReverted: reverted[0].title === 'renamed',
			guestEditApplied: true,
			revokeRemoved: true,
			deletePropagated: true,
		}),
	);
	await browser.close();
}

await run('chromium', () => chromium.launch());
await run('webkit', () => webkit.launch());
