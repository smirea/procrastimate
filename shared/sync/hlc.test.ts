import { describe, expect, test } from 'bun:test';
import { compareHlc, createClock, formatHlc, observe, parseHlc, tick } from './hlc.ts';

describe('hlc', () => {
	test('formats and parses wall time, counter, and node', () => {
		const clock = { wall: 1700000000000, counter: 3, node: 'device-a' };
		expect(formatHlc(clock)).toBe('1700000000000:3:device-a');
		expect(parseHlc(formatHlc(clock))).toEqual(clock);
	});

	test('compares as a tuple, not as text', () => {
		expect(compareHlc('9:0:a', '10:0:a')).toBeLessThan(0);
		expect(compareHlc('10:9:a', '10:10:a')).toBeLessThan(0);
		expect(compareHlc('10:1:a', '10:1:b')).toBeLessThan(0);
		expect(compareHlc('10:1:b', '10:1:b')).toBe(0);
	});

	test('ticks to the wall time when it moved on, else counts up', () => {
		let clock = tick(createClock('a'), 100);
		expect(formatHlc(clock)).toBe('100:0:a');
		clock = tick(clock, 100);
		expect(formatHlc(clock)).toBe('100:1:a');
		clock = tick(clock, 90);
		expect(formatHlc(clock)).toBe('100:2:a');
		clock = tick(clock, 101);
		expect(formatHlc(clock)).toBe('101:0:a');
	});

	test('never issues a clock below one it has seen', () => {
		const behind = tick(createClock('a'), 100);
		const seen = observe(behind, '500:4:server');
		const next = tick(seen, 120);
		expect(compareHlc(formatHlc(next), '500:4:server')).toBeGreaterThan(0);
		expect(next.node).toBe('a');
		expect(observe(next, '50:0:b')).toBe(next);
	});
});
