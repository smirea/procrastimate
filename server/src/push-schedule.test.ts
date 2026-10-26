import { describe, expect, test } from 'bun:test';
import { MAX_SCHEDULED } from '../../shared/push';
import { classifyDelivery, nextAlarm, planSchedule } from './push-schedule';

const NOW = 1_000_000_000;
const push = (title: string, at: number) => ({ at, title, body: '', opens: { kind: 'task' as const, id: title } });

describe('planSchedule', () => {
	test('sorts by time and keeps one push per moment', () => {
		const plan = planSchedule(
			[push('b', NOW + 2), push('a', NOW + 1), push('b', NOW + 2), push('b', NOW + 3)],
			[],
			0,
			NOW,
		);
		expect(plan.map(p => `${p.title}@${p.at - NOW}`)).toEqual(['a@1', 'b@2', 'b@3']);
	});

	test('keeps a past push only while it is still pending, and never one more than ten minutes stale', () => {
		const computed = [
			push('stale', NOW - 600_001),
			push('late', NOW - 600_000),
			push('new', NOW - 5),
			push('next', NOW + 5),
		];
		expect(planSchedule(computed, [], 0, NOW).map(p => p.title)).toEqual(['next']);
		const pending = [push('stale', NOW - 600_001), push('late', NOW - 600_000)];
		expect(planSchedule(computed, pending, 0, NOW).map(p => p.title)).toEqual(['late', 'next']);
	});

	test('drops a pending push the tasks no longer make', () => {
		expect(planSchedule([], [push('done', NOW - 5), push('later', NOW + 5)], 0, NOW)).toEqual([]);
	});

	test('never brings back a future push the alarm already delivered', () => {
		expect(planSchedule([push('sent', NOW + 5)], [], NOW + 5, NOW)).toEqual([]);
	});

	test('keeps a push that is still stored for a retry even though it is before deliveredThrough', () => {
		const retry = push('retry', NOW - 60_000);
		const plan = planSchedule([retry, push('delivered', NOW - 30_000)], [retry], NOW - 1, NOW);
		expect(plan.map(p => p.title)).toEqual(['retry']);
	});

	test('keeps the earliest pushes when over the cap', () => {
		const incoming = Array.from({ length: MAX_SCHEDULED + 2 }, (_, i) => push(`t${i}`, NOW + MAX_SCHEDULED + 2 - i));
		const plan = planSchedule(incoming, [], 0, NOW);
		expect(plan.length).toBe(500);
		expect(plan[0]?.at).toBe(NOW + 1);
		expect(plan.at(-1)?.at).toBe(NOW + 500);
	});
});

test('nextAlarm wakes for the earliest push, fires an untried due one now, retries a minute after a try, and stops when empty', () => {
	expect(nextAlarm([push('b', NOW + 9), push('a', NOW + 4)], 0, NOW)).toBe(NOW + 4);
	expect(nextAlarm([push('untried', NOW - 10), push('later', NOW + 9)], NOW - 20, NOW)).toBe(NOW);
	expect(nextAlarm([push('retry', NOW - 10), push('later', NOW + 120_000)], NOW - 5, NOW)).toBe(NOW - 5 + 60_000);
	expect(nextAlarm([push('retry', NOW - 120_000)], NOW - 100_000, NOW)).toBe(NOW);
	expect(nextAlarm([], 0, NOW)).toBe(null);
});

test('classifyDelivery maps push service responses', () => {
	expect([201, 400, 404, 410, 413, 429, 500, 503, null].map(classifyDelivery)).toEqual([
		'sent',
		'sent',
		'gone',
		'gone',
		'sent',
		'retry',
		'retry',
		'retry',
		'retry',
	]);
});
