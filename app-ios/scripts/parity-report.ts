#!/usr/bin/env bun
// Builds a static page that shows each parity id's web and iOS screenshots side by side.
// Usage: bun scripts/parity-report.ts <web-dir> <ios-dir> <out-dir>
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [web, ios, out] = process.argv.slice(2);
if (!web || !ios || !out) throw new Error('Usage: bun scripts/parity-report.ts <web-dir> <ios-dir> <out-dir>');

const shots = (dir: string) =>
	new Set(
		existsSync(dir)
			? readdirSync(dir)
					.filter(file => file.endsWith('.png'))
					.map(file => basename(file, '.png'))
			: [],
	);
const sides = { web: shots(web), ios: shots(ios) };
const ids = [...new Set([...sides.web, ...sides.ios])].sort();

for (const [side, dir] of [
	['web', web],
	['ios', ios],
] as const) {
	mkdirSync(join(out, side), { recursive: true });
	for (const id of sides[side]) copyFileSync(join(dir, `${id}.png`), join(out, side, `${id}.png`));
}

const escape = (text: string) =>
	text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cell = (side: 'web' | 'ios', id: string) =>
	sides[side].has(id)
		? `<img src="${side}/${escape(id)}.png" alt="${side} ${escape(id)}">`
		: `<p class="missing">No ${side} screenshot</p>`;
const rows = ids.map(
	id => `<section id="${escape(id)}"><h2>${escape(id)}</h2><div>${cell('web', id)}${cell('ios', id)}</div></section>`,
);

writeFileSync(
	join(out, 'index.html'),
	`<!doctype html>
<meta charset="utf-8">
<title>Procrastimate parity report</title>
<style>
    body { font: 15px system-ui, sans-serif; margin: 2rem; background: #f6f6f7; color: #18181b; }
    section { margin-bottom: 3rem; }
    h2 { font-size: 1rem; font-family: ui-monospace, monospace; }
    div { display: grid; grid-template-columns: repeat(2, minmax(0, 393px)); gap: 1.5rem; align-items: start; }
    img { width: 100%; border-radius: 1rem; box-shadow: 0 8px 24px -12px rgb(0 0 0 / 0.4); }
    .missing { color: #56565f; }
    header div { font-weight: 600; }
</style>
<h1>Parity report</h1>
<p>${ids.length} screenshots: ${sides.web.size} web (WebKit, iPhone 15 Pro), ${sides.ios.size} iOS (iPhone 16 simulator).</p>
<header><div><span>Web</span><span>iOS</span></div></header>
${rows.join('\n')}
`,
);
console.log(`Wrote ${join(out, 'index.html')} with ${ids.length} ids.`);
