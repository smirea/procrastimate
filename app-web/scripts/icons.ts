/**
 * Renders the app icons in `static/icons/` and the iOS `AppIcon` from `scripts/app-icon.svg`, and `static/favicon.ico`
 * from the simpler `static/icons/favicon.svg`, with Playwright's Chromium.
 * Run `bun scripts/icons.ts` from `app-web/` after editing either SVG.
 */
import { chromium } from '@playwright/test';

const dir = new URL('../static/icons/', import.meta.url);
const svg = await Bun.file(new URL('app-icon.svg', import.meta.url)).text();
const favicon = await Bun.file(new URL('favicon.svg', dir)).text();
const tile = svg.match(/id="tile"[^>]*fill="(#[\da-f]+)"/i)?.[1];
if (!tile) throw new Error('app-icon.svg needs a #tile rect with a hex fill');

/**
 * `bleed` fills the corners with the tile color, for launchers and iOS that apply their own mask.
 * `inset` shrinks the glyph so it fits inside the maskable safe zone (a circle of 40% radius).
 * `glyph` drops the tile, because Android draws notification badges from the alpha channel only.
 */
const variants = [
	{ file: 'icon-192.png', size: 192, look: 'tile' },
	{ file: 'icon-512.png', size: 512, look: 'tile' },
	{ file: 'maskable-512.png', size: 512, look: 'bleed', inset: 0.8 },
	{ file: 'apple-touch-icon.png', size: 180, look: 'bleed' },
	{ file: 'badge-96.png', size: 96, look: 'glyph' },
	{
		file: '../../../app-ios/Sources/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
		size: 1024,
		look: 'bleed',
	},
] as const;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const variant of variants) {
	const { file, size, look } = variant;
	const inset = 'inset' in variant ? variant.inset : 1;
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(`<style>
		html, body { margin: 0; background: ${look === 'bleed' ? tile : 'transparent'}; }
		svg { display: block; width: 100vw; height: 100vh; }
		#glyph { transform: scale(${inset}); transform-box: view-box; transform-origin: center; }
		${look === 'glyph' ? '#tile { display: none; } #glyph * { opacity: 1; }' : ''}
	</style>${svg}`);
	await page.screenshot({ path: new URL(file, dir).pathname, omitBackground: look !== 'bleed' });
	console.log(`${file} ${size}x${size}`);
}

/** `favicon.ico` holds PNG frames at 16, 32 and 48 pixels for browsers and tools that don't take the SVG. */
const frames: Uint8Array[] = [];
const sizes = [16, 32, 48];
for (const size of sizes) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(`<style>
		html, body { margin: 0; background: transparent; }
		svg { display: block; width: 100vw; height: 100vh; }
	</style>${favicon}`);
	frames.push(await page.screenshot({ omitBackground: true }));
}
await browser.close();
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, i) => {
	const entry = 6 + 16 * i;
	header.writeUInt8(sizes[i]!, entry);
	header.writeUInt8(sizes[i]!, entry + 1);
	header.writeUInt16LE(1, entry + 4);
	header.writeUInt16LE(32, entry + 6);
	header.writeUInt32LE(frame.length, entry + 8);
	header.writeUInt32LE(offset, entry + 12);
	offset += frame.length;
});
await Bun.write(new URL('../favicon.ico', dir), Buffer.concat([header, ...frames]));
console.log(`favicon.ico ${sizes.join('/')}`);
