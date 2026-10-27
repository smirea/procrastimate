import { expect } from 'bun:test';
import * as accents from './accents.ts';
import { describe, recorded, test } from './vectors/record.ts';

const deriveAccent = recorded('accents', accents.deriveAccent);
const parseAccent = recorded('accents', accents.parseAccent);

describe('deriveAccent', () => {
	test('a preset keeps the accent it shipped with', () => {
		expect(deriveAccent('#3d9bff')).toEqual({
			light: { accent: [0, 103, 189], onAccent: [255, 255, 255], glow: [216, 234, 255], glowAlpha: 0.6 },
			dark: { accent: [90, 168, 255], onAccent: [4, 22, 44], glow: [61, 155, 255], glowAlpha: 0.11 },
		});
		expect(deriveAccent('#9b5cff').dark.accent).toEqual([178, 141, 255]);
	});

	test('a pale custom color darkens in light and dims its dark glow and accent', () => {
		expect(deriveAccent('#ffffff')).toEqual({
			light: { accent: [103, 103, 103], onAccent: [255, 255, 255], glow: [232, 232, 232], glowAlpha: 0.6 },
			dark: { accent: [164, 164, 164], onAccent: [22, 22, 22], glow: [164, 164, 164], glowAlpha: 0.11 },
		});
		expect(deriveAccent('#ffff00').dark).toEqual({
			accent: [174, 174, 0],
			onAccent: [23, 23, 0],
			glow: [174, 174, 0],
			glowAlpha: 0.11,
		});
	});

	test('a dark custom color brightens in dark and keeps its glow', () => {
		expect(deriveAccent('#000000').dark).toEqual({
			accent: [164, 164, 164],
			onAccent: [22, 22, 22],
			glow: [0, 0, 0],
			glowAlpha: 0.11,
		});
		expect(deriveAccent('#1a2b6d').dark.glow).toEqual([26, 43, 109]);
	});

	test('every preset and a grid of custom colors derive in-range colors', () => {
		const presets = Object.values(accents.ACCENTS).map(accent => accent.base);
		const levels = ['00', '55', 'aa', 'ff'];
		const grid = levels.flatMap(r => levels.flatMap(g => levels.map(b => `#${r}${g}${b}`)));
		for (const base of [...presets, ...grid, '#ff8000', '#80ff00', '#c0ffee', '#ffe4e1', '#003300']) {
			const { light, dark } = deriveAccent(base);
			for (const value of [light.accent, light.glow, dark.accent, dark.onAccent, dark.glow].flat()) {
				expect(Number.isInteger(value) && value >= 0 && value <= 255).toBe(true);
			}
		}
	});
});

describe('parseAccent', () => {
	test('a preset key or a #rrggbb color is kept, in lowercase; anything else is the default', () => {
		expect(['violet', '#AABBCC', '#c0ffee', null, 'bogus', '#abc', 'c0ffee', '#c0ffeeff'].map(parseAccent)).toEqual([
			'violet',
			'#aabbcc',
			'#c0ffee',
			'frost',
			'frost',
			'frost',
			'frost',
			'frost',
		]);
	});
});
