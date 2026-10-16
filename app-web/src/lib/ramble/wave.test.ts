import { describe, expect, test } from 'bun:test';
import { DOT, waveHeights } from './wave.ts';

describe('waveHeights', () => {
	test('silence is a row of dots', () => {
		const sizes = waveHeights(new Float32Array(48), { bars: 5, height: 80, presence: 1 }).map(bar => bar.size);
		expect(sizes).toEqual([DOT, DOT, DOT, DOT, DOT]);
	});

	test('the newest level is the tallest bar, in the middle, and older ones ripple outward', () => {
		const history = [0, 0, 0, 0.25, 1];
		const sizes = waveHeights(history, { bars: 5, height: 84, presence: 1 }).map(bar => Math.round(bar.size));
		expect(sizes).toEqual([4, 4, 84, 4, 4]);
	});

	test('at rest every bar settles to a dot, even with sound', () => {
		const sizes = waveHeights([1, 1, 1], { bars: 3, height: 80, presence: 0 }).map(bar => bar.size);
		expect(sizes).toEqual([DOT, DOT, DOT]);
	});
});
