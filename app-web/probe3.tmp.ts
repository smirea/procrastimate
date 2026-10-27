import { webkit } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const open = async () => {
	const ctx = await webkit.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pw-')), {
		baseURL: 'http://127.0.0.1:6300',
	});
	const page = await ctx.newPage();
	await page.goto('/favicon.svg').catch(() => {});
	return { ctx, page };
};
const a = await open();
await a.page.evaluate(async () => {
	localStorage.setItem('probe', 'A');
	const root = await navigator.storage.getDirectory();
	await root.getFileHandle('probe-from-a', { create: true });
});
const b = await open();
console.log('B localStorage', await b.page.evaluate(() => localStorage.getItem('probe')));
console.log(
	'B opfs',
	await b.page.evaluate(async () => {
		const names = [];
		for await (const [n] of (await navigator.storage.getDirectory()).entries()) names.push(n);
		return names;
	}),
);
await a.ctx.close();
await b.ctx.close();
