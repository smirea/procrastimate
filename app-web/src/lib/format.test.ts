import { describe, expect, test } from 'bun:test';
import { formatRecurrence } from './format.ts';

const today = '2026-10-14';

describe('formatRecurrence', () => {
	test.each([
		[{ interval: 1, unit: 'week', days: [1, 3, 5] }, 'Every Mon, Wed, Fri'],
		[{ interval: 1, unit: 'week', days: [6, 0] }, 'Every Sat, Sun'],
		[{ interval: 2, unit: 'week', days: [2, 4] }, 'Every 2 weeks on Tue, Thu'],
		[{ interval: 2, unit: 'week' }, 'Every 2 weeks'],
		[{ interval: 1, unit: 'week' }, 'Every Wed'],
		[{ interval: 1, unit: 'weekday' }, 'Every weekday'],
	] as const)('%p reads %p', (recurrence, expected) => {
		expect(formatRecurrence(recurrence, { date: today, time: null })).toBe(expected);
	});
});
