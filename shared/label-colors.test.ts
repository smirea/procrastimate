import { expect } from 'bun:test';
import * as labelColors from './label-colors.ts';
import { describe, recorded, test } from './vectors/record.ts';

const defaultLabelColor = recorded('label-colors', labelColors.defaultLabelColor);

describe('defaultLabelColor', () => {
	test('a word with an obvious color picks it, ignoring case and the words around it', () => {
		const names = [
			'bug',
			'Urgent',
			'waiting on',
			'calls',
			'errands',
			'health',
			'reading list',
			'someday-maybe',
			'deep work',
			'creative work',
		];
		expect(names.map(name => defaultLabelColor(name))).toEqual([
			'red',
			'red',
			'amber',
			'blue',
			'orange',
			'green',
			'violet',
			'amber',
			'indigo',
			'violet',
		]);
	});

	test('every hint word picks its color, so the Swift table must list the same words', () => {
		for (const [color, words] of Object.entries(labelColors.LABEL_COLOR_HINTS)) {
			for (const word of words) expect(defaultLabelColor(word)).toBe(color as labelColors.LabelColor);
		}
		expect(defaultLabelColor('fix')).toBe('violet');
	});

	test('any other name hashes to a stable color, the same for every case and surrounding space', () => {
		const names = ['tom', 'home', '  Home  ', 'café', '日本', 'Long Term Goals 🎯', 'v2', ''];
		expect(names.map(name => defaultLabelColor(name))).toEqual([
			'teal',
			'pink',
			'pink',
			'violet',
			'orange',
			'pink',
			'blue',
			'lime',
		]);
	});

	test('the hash spreads names across the palette and never picks gray', () => {
		const picked = new Set(Array.from({ length: 200 }, (_, i) => labelColors.defaultLabelColor(`label ${i}`)));
		expect(picked.has('gray')).toBe(false);
		expect(picked.size).toBe(labelColors.LABEL_COLORS.length - 1);
	});
});
