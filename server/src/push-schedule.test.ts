import { describe, expect, test } from 'bun:test';
import { MAX_SCHEDULED } from '../../shared/push';
import { classifyDelivery, nextAlarm, planSchedule, splitDue } from './push-schedule';

const NOW = 1_000_000_000;
const push = (taskId: string, at: number) => ({ taskId, at, title: taskId, body: '' });

describe('planSchedule', () => {
	test('sorts by time and dedupes by task and time', () => {
		const plan = planSchedule([push('b', NOW + 2), push('a', NOW + 1), push('b', NOW + 2), push('b', NOW + 3)], 0, NOW);
		expect(plan.map(p => `${p.taskId}@${p.at - NOW}`)).toEqual(['a@1', 'b@2', 'b@3']);
	});

	test('drops what was already delivered and what is more than ten minutes stale', () => {
		const plan = planSchedule(
			[push('stale', NOW - 600_001), push('late', NOW - 600_000), push('delivered', NOW - 5), push('next', NOW + 5)],
			NOW - 5,
			NOW,
		);
		expect(plan.map(p => p.taskId)).toEqual(['next']);
		expect(planSchedule([push('late', NOW - 600_000)], 0, NOW).map(p => p.taskId)).toEqual(['late']);
	});

	test('keeps the earliest pushes when over the cap', () => {
		const incoming = Array.from({ length: MAX_SCHEDULED + 2 }, (_, i) => push(`t${i}`, NOW + MAX_SCHEDULED + 2 - i));
		const plan = planSchedule(incoming, 0, NOW);
		expect(plan.length).toBe(500);
		expect(plan[0]?.at).toBe(NOW + 1);
		expect(plan.at(-1)?.at).toBe(NOW + 500);
	});
});

test('splitDue treats now as due', () => {
	const { due, pending } = splitDue([push('past', NOW - 1), push('now', NOW), push('later', NOW + 1)], NOW);
	expect(due.map(p => p.taskId)).toEqual(['past', 'now']);
	expect(pending.map(p => p.taskId)).toEqual(['later']);
});

test('nextAlarm wakes for the earliest push, retries overdue ones in a minute, and stops when empty', () => {
	expect(nextAlarm([push('b', NOW + 9), push('a', NOW + 4)], NOW)).toBe(NOW + 4);
	expect(nextAlarm([push('retry', NOW - 1), push('later', NOW + 9)], NOW)).toBe(NOW + 60_000);
	expect(nextAlarm([], NOW)).toBe(null);
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
