import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

type Rgba = [number, number, number, number];
type Tokens = Record<string, string>;

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function block(selector: string): Tokens {
	const start = css.indexOf(`\n${selector} {`);
	if (start < 0) throw new Error(`index.css has no ${selector} block`);
	const body = css.slice(start, css.indexOf('\n}', start));
	return Object.fromEntries(
		[...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]),
	);
}

const light = { ...block('@theme'), ...block(':root') };
const themes: Record<string, Tokens> = { light, dark: { ...light, ...block(":root[data-theme='dark']") } };

function color(tokens: Tokens, value: string): Rgba {
	const reference = value.match(/^var\((--[\w-]+)\)$/);
	if (reference) return color(tokens, tokens[reference[1]!]!);
	const hex = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (hex) return [...hex.slice(1, 4).map(h => parseInt(h, 16)), 1] as Rgba;
	const rgb = value.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/);
	if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] ? Number(rgb[4]) : 1];
	throw new Error(`Unsupported color ${value}`);
}

const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
	r * a + br * (1 - a),
	g * a + bg * (1 - a),
	b * a + bb * (1 - a),
	1,
];

const alpha = ([r, g, b]: Rgba, a: number): Rgba => [r, g, b, a];

function luminance([r, g, b]: Rgba) {
	const [lr, lg, lb] = [r, g, b].map(c => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

function contrast(text: Rgba, background: Rgba) {
	const [hi, lo] = [luminance(over(text, background)), luminance(background)].sort((a, b) => b - a);
	return (hi! + 0.05) / (lo! + 0.05);
}

/** Text pairs that ship in the UI, each checked against every backdrop it can sit on. */
function pairs(tokens: Tokens) {
	const c = (name: string) => color(tokens, `var(${name})`);
	const canvas = c('--canvas');
	const canvases = [canvas, over(c('--canvas-glow-warm'), canvas), over(c('--canvas-glow-cool'), canvas)];
	const surfaces = {
		canvas: canvases,
		glass: canvases.map(bg => over(c('--glass-bg'), bg)),
		'glass-strong': canvases.map(bg => over(c('--glass-strong-bg'), bg)),
		drawer: canvases.map(bg => over(c('--drawer-bg'), bg)),
		chip: canvases.map(bg => over(alpha(c('--color-surface'), 0.6), over(c('--glass-strong-bg'), bg))),
	};
	const highlights = Object.keys(tokens)
		.filter(name => name.startsWith('--token-'))
		.map(name => ({
			text: '--color-ink',
			surface: name,
			ratio: Math.min(...surfaces['glass-strong'].map(bg => contrast(c('--color-ink'), over(c(name), bg)))),
		}));
	const texts = [
		'--color-ink',
		'--color-muted',
		'--color-faint',
		'--color-accent',
		'--tone-overdue',
		'--tone-today',
		'--tone-tomorrow',
		'--tone-week',
		'--tone-later',
	];
	const accent = c('--color-accent');
	const activeNav = surfaces.glass.map(bg => over(alpha(accent, 0.08), bg));
	const toast = canvases.map(bg => over(c('--toast-bg'), bg));
	return [
		...highlights,
		...Object.entries(surfaces).flatMap(([surface, backdrops]) =>
			texts.map(text => ({ text, surface, ratio: Math.min(...backdrops.map(bg => contrast(c(text), bg))) })),
		),
		{ text: '--color-accent', surface: 'active nav', ratio: Math.min(...activeNav.map(bg => contrast(accent, bg))) },
		{ text: '--color-on-accent', surface: '--color-accent', ratio: contrast(c('--color-on-accent'), accent) },
		{
			text: '--color-on-accent',
			surface: '--tone-overdue',
			ratio: contrast(c('--color-on-accent'), c('--tone-overdue')),
		},
		{ text: 'white', surface: 'toast', ratio: Math.min(...toast.map(bg => contrast([255, 255, 255, 1], bg))) },
		{
			text: '--toast-action',
			surface: 'toast',
			ratio: Math.min(...toast.map(bg => contrast(c('--toast-action'), bg))),
		},
	];
}

test('every literal light color has a dark value', () => {
	const dark = block(":root[data-theme='dark']");
	const lightColors = { ...block('@theme'), ...block(':root') };
	const missing = Object.entries(lightColors)
		.filter(([name, value]) => /^(#|rgb\()/.test(value) && !(name in dark))
		.map(([name]) => name);
	expect(missing).toEqual([]);
});

for (const [name, tokens] of Object.entries(themes)) {
	test(`${name} theme text meets WCAG AA contrast`, () => {
		const failing = pairs(tokens)
			.filter(pair => pair.ratio < 4.5)
			.map(pair => `${pair.text} on ${pair.surface}: ${pair.ratio.toFixed(2)}`);
		expect(failing).toEqual([]);
	});
}
