import { chromium, webkit } from '@playwright/test';
const base = 'http://127.0.0.1:6300';
const browser = await (process.env.WK ? webkit : chromium).launch();
const ctx = await browser.newContext({ baseURL: base });
const email = `p-${crypto.randomUUID()}@procrastimate.test`;
const r = await ctx.request.post('/api/auth/sign-up/email', { data: { email, password: 'e2e-password-1', name: 'P' } });
console.log('signup', r.status());
const page = await ctx.newPage();
page.on('websocket', ws => {
	console.log('ws', ws.url());
	ws.on('framereceived', f => console.log('frame', String(f.payload).slice(0, 80)));
	ws.on('close', () => console.log('ws closed'));
});
page.on('worker', w => console.log('worker', w.url()));
page.on('console', m => console.log('console', m.type(), m.text().slice(0, 300)));
page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
ctx.on('request', q => {
	if (q.url().includes('/api/')) console.log('req', q.method(), new URL(q.url()).pathname);
});
ctx.on('response', q => {
	if (q.url().includes('/api/')) console.log('res', q.status(), new URL(q.url()).pathname);
});
await page.goto('/inbox');
await page.waitForTimeout(4000);
console.log('pending', await page.evaluate(() => (window as any).procrastimate?.pending?.()));
console.log('reads', JSON.stringify(await page.evaluate(() => (window as any).procrastimate?.reads?.())));
console.log('body', (await page.locator('body').innerText()).slice(0, 300).replace(/\n/g, ' | '));
await browser.close();
