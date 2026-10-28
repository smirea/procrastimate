import { expect, test } from 'bun:test';
import { rubberBand, settle } from './drawer-drag.ts';

test('a released drag expands, closes, or springs back by distance or flick', () => {
	expect(settle(-200, 0, 600, 300)).toBe('expand');
	expect(settle(-100, 0, 600, 300)).toBe('back');
	expect(settle(-40, -0.8, 600, 300)).toBe('expand');
	expect(settle(-4, -2, 600, 300)).toBe('back');
	expect(settle(120, 0, 600, 300)).toBe('close');
	expect(settle(60, 0, 600, 300)).toBe('back');
	expect(settle(30, 0.9, 600, 300)).toBe('close');
});

test('rubber banding gives less and less and never passes its limit', () => {
	expect(rubberBand(0)).toBe(0);
	expect(rubberBand(100)).toBeCloseTo(37.71, 2);
	expect(rubberBand(10_000)).toBeLessThan(120);
});
