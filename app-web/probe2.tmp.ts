import { webkit } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = 'http://127.0.0.1:6300';
const email = `p-${crypto.randomUUID()}@procrastimate.test`;
async function device(name: string) {
	const ctx = await webkit.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pw-')), {
		baseURL: base,
		serviceWorkers: 'block',
	});
	const signed = await ctx.request.post('/api/auth/sign-up/email', {
		data: { email, password: 'e2e-password-1', name: 'P' },
	});
	if (!signed.ok()) await ctx.request.post('/api/auth/sign-in/email', { data: { email, password: 'e2e-password-1' } });
	const page = await ctx.newPage();
	page.on('console', m => console.log(name, 'console', m.type(), m.text().slice(0, 200)));
	page.on('websocket', ws => {
		console.log(name, 'ws', ws.url());
		ws.on('framereceived', f => console.log(name, 'frame', String(f.payload).slice(0, 60)));
		ws.on('close', () => console.log(name, 'ws closed'));
		ws.on('socketerror', e => console.log(name, 'ws error', e));
	});
	ctx.on('request', q => {
		if (q.url().includes('/api/sync')) console.log(name, 'req', new URL(q.url()).pathname);
	});
	ctx.on('response', async q => {
		if (q.url().endsWith('/api/sync'))
			console.log(name, 'res', q.status(), (await q.text().catch(e => String(e))).slice(0, 300));
	});
	ctx.on('request', q => {
		if (q.url().endsWith('/api/sync')) console.log(name, 'body', (q.postData() ?? '').slice(0, 300));
	});
	await page.goto('/inbox');
	await page.waitForTimeout(3000);
	return { ctx, page };
}
const a = await device('A');
const b = await device('B');
await a.page.keyboard.press('q');
await a.page.waitForTimeout(500);
await a.page.keyboard.type('Probe task');
await a.page.keyboard.press('Enter');
await a.page.waitForTimeout(5000);
console.log('A pending', await a.page.evaluate(() => (window as any).procrastimate.pending()));
console.log('A has', await a.page.evaluate(() => (window as any).procrastimate.taskId('Probe task')));
console.log('B has', await b.page.evaluate(() => (window as any).procrastimate.taskId('Probe task')));
await a.ctx.close();
await b.ctx.close();
