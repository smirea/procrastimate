import { describe, expect, test } from 'bun:test';
import { notificationTimes, type Due, type Reminder } from './task.ts';

const at = (date: Date) => date.toISOString();
const times = (due: Due | null, reminders: Reminder[] = []) => notificationTimes(due, reminders).map(at);
const local = (date: string, time: string) => at(new Date(`${date}T${time}:00`));

describe('notificationTimes', () => {
	test('a due time notifies at that time with no reminder', () => {
		expect(times({ date: '2026-10-15', time: '17:00' })).toEqual([local('2026-10-15', '17:00')]);
	});

	test('a date with no time does not notify', () => {
		expect(times({ date: '2026-10-15', time: null })).toEqual([]);
		expect(times(null)).toEqual([]);
	});

	test('reminders add to the due time, in order', () => {
		expect(
			times({ date: '2026-10-15', time: '17:00' }, [
				{ kind: 'at', date: '2026-10-15', time: '18:00' },
				{ kind: 'before', minutes: 30 },
			]),
		).toEqual([local('2026-10-15', '16:30'), local('2026-10-15', '17:00'), local('2026-10-15', '18:00')]);
	});

	test('a reminder at the due time notifies once', () => {
		expect(
			times({ date: '2026-10-15', time: '17:00' }, [
				{ kind: 'before', minutes: 0 },
				{ kind: 'at', date: '2026-10-15', time: '17:00' },
			]),
		).toEqual([local('2026-10-15', '17:00')]);
	});

	test('a date-only task still notifies at an absolute reminder', () => {
		expect(
			times({ date: '2026-10-15', time: null }, [
				{ kind: 'before', minutes: 10 },
				{ kind: 'at', date: '2026-10-15', time: '09:00' },
			]),
		).toEqual([local('2026-10-15', '09:00')]);
	});
});
