import { describe, expect, test } from 'bun:test';
import { parseQuickAdd, type ParseOptions } from './quick-add.ts';

// Wednesday, October 14 2026, 10:00 local time.
const now = new Date(2026, 9, 14, 10, 0);
const projects = [
	{ id: 'p-home', name: 'Home', createdAt: 0 },
	{ id: 'p-side', name: 'Side Project', createdAt: 0 },
];
const parse = (input: string, options: Partial<ParseOptions> = {}) =>
	parseQuickAdd(input, { now, projects, ...options });

describe('the example from the brief', () => {
	test('call mom tomorrow 5pm remind me 30m before', () => {
		const parsed = parse('call mom tomorrow 5pm remind me 30m before');
		expect(parsed.title).toBe('call mom');
		expect(parsed.due).toEqual({ date: '2026-10-15', time: '17:00' });
		expect(parsed.reminders).toEqual([{ kind: 'before', minutes: 30 }]);
		expect(parsed.tokens).toEqual([
			{ kind: 'due', start: 9, end: 21, text: 'tomorrow 5pm' },
			{ kind: 'reminder', start: 22, end: 42, text: 'remind me 30m before' },
		]);
	});
});

describe('due dates', () => {
	test.each([
		['Pay rent today', '2026-10-14', null],
		['Pay rent tonight', '2026-10-14', '20:00'],
		['Pay rent tonight at 9pm', '2026-10-14', '21:00'],
		['Pay rent tomorrow', '2026-10-15', null],
		['Pay rent tmrw', '2026-10-15', null],
		['Pay rent wed', '2026-10-14', null],
		['Pay rent fri', '2026-10-16', null],
		['Pay rent on monday', '2026-10-19', null],
		['Pay rent next week', '2026-10-19', null],
		['Pay rent next friday', '2026-10-23', null],
		['Pay rent in 3 days', '2026-10-17', null],
		['Pay rent in 2 weeks', '2026-10-28', null],
		['Pay rent oct 20', '2026-10-20', null],
		['Pay rent 3rd november', '2026-11-03', null],
		['Pay rent jan 5', '2027-01-05', null],
		['Pay rent at 5:30pm', '2026-10-14', '17:30'],
		['Pay rent 17:45', '2026-10-14', '17:45'],
		['Pay rent at noon', '2026-10-14', '12:00'],
		['Pay rent 9am fri', '2026-10-16', '09:00'],
		['Pay rent fri at 12am', '2026-10-16', '00:00'],
	])('%s', (input, date, time) => {
		const parsed = parse(input);
		expect(parsed.title).toBe('Pay rent');
		expect<unknown>(parsed.due).toEqual({ date, time });
	});

	test('the last date phrase wins, so a leading date word stays in the title', () => {
		const parsed = parse('Today task today');
		expect(parsed.title).toBe('Today task');
		expect(parsed.due).toEqual({ date: '2026-10-14', time: null });
	});

	test('date words inside other words stay in the title', () => {
		const parsed = parse('Fix monitor and update todays notes');
		expect(parsed.title).toBe('Fix monitor and update todays notes');
		expect(parsed.due).toBe(null);
	});

	test('an impossible date or time stays in the title', () => {
		const parsed = parse('Buy gift feb 30 at 13pm');
		expect(parsed.title).toBe('Buy gift feb 30 at 13pm');
		expect(parsed.due).toBe(null);
	});
});

describe('priority', () => {
	test.each([
		['File taxes p1', 1],
		['File taxes P2', 2],
		['File taxes p3', 3],
		['File taxes p4', 4],
		['File taxes !!!', 1],
		['File taxes !!', 2],
		['File taxes urgent', 1],
		['Urgent file taxes', 1],
		['File taxes important', 2],
	])('%s', (input, priority) => {
		const parsed = parse(input);
		expect<unknown>(parsed.priority).toBe(priority);
		expect(parsed.title.toLowerCase()).toBe('file taxes');
	});

	test('a single bang and p5 are title text', () => {
		const parsed = parse('Ship it ! p5');
		expect(parsed.title).toBe('Ship it ! p5');
		expect(parsed.priority).toBe(null);
	});

	test('bangs attached to a word are title text', () => {
		const parsed = parse('Wow!! nice');
		expect(parsed.title).toBe('Wow!! nice');
		expect(parsed.priority).toBe(null);
	});

	test('the last priority wins and earlier ones stay in the title', () => {
		const parsed = parse('p2 Review deck p1');
		expect(parsed.priority).toBe(1);
		expect(parsed.title).toBe('p2 Review deck');
	});
});

describe('reminders', () => {
	test.each([
		['remind me 1 hour before', 60],
		['remind me 2h before', 120],
		['remind me 45 minutes before', 45],
		['remind me 1 day before', 1440],
		['remind 10 min before', 10],
	])('%s', (phrase, minutes) => {
		const parsed = parse(`Dentist fri 3pm ${phrase}`);
		expect(parsed.title).toBe('Dentist');
		expect(parsed.due).toEqual({ date: '2026-10-16', time: '15:00' });
		expect(parsed.reminders).toEqual([{ kind: 'before', minutes }]);
	});

	test('an absolute reminder time lands on the due date', () => {
		const parsed = parse('Dentist fri 3pm remind me at 1pm');
		expect(parsed.reminders).toEqual([{ kind: 'at', date: '2026-10-16', time: '13:00' }]);
	});

	test('an absolute reminder without a due date lands today', () => {
		const parsed = parse('Water plants remind me at 6pm');
		expect(parsed.title).toBe('Water plants');
		expect(parsed.due).toBe(null);
		expect(parsed.reminders).toEqual([{ kind: 'at', date: '2026-10-14', time: '18:00' }]);
	});

	test('a reminder date without a time defaults to 9am', () => {
		const parsed = parse('Renew passport remind me next monday');
		expect(parsed.reminders).toEqual([{ kind: 'at', date: '2026-10-19', time: '09:00' }]);
	});

	test('reminder dates do not become the due date', () => {
		const parsed = parse('Book flights remind me tomorrow 9am');
		expect(parsed.due).toBe(null);
		expect(parsed.reminders).toEqual([{ kind: 'at', date: '2026-10-15', time: '09:00' }]);
	});

	test('several reminders are all kept', () => {
		const parsed = parse('Launch oct 20 10am remind me 1 day before remind me 15m before');
		expect(parsed.title).toBe('Launch');
		expect(parsed.reminders).toEqual([
			{ kind: 'before', minutes: 1440 },
			{ kind: 'before', minutes: 15 },
		]);
	});
});

describe('projects', () => {
	test('a known project is assigned case-insensitively', () => {
		const parsed = parse('Fix sink #home');
		expect(parsed.title).toBe('Fix sink');
		expect(parsed.projectId).toBe('p-home');
		expect(parsed.tokens).toEqual([{ kind: 'project', start: 9, end: 14, text: '#home' }]);
	});

	test('multi-word project names match', () => {
		const parsed = parse('Write docs #Side Project tomorrow');
		expect(parsed.title).toBe('Write docs');
		expect(parsed.projectId).toBe('p-side');
		expect(parsed.due).toEqual({ date: '2026-10-15', time: null });
	});

	test('an unknown project stays in the title', () => {
		const parsed = parse('Fix sink #garage');
		expect(parsed.title).toBe('Fix sink #garage');
		expect(parsed.projectId).toBe(null);
	});
});

describe('disabled tokens', () => {
	test('a disabled phrase stays in the title while other phrases still parse', () => {
		const parsed = parse('Read Monday Night Club p1', { disabled: ['monday'] });
		expect(parsed.title).toBe('Read Monday Night Club');
		expect(parsed.due).toBe(null);
		expect(parsed.priority).toBe(1);
	});

	test('a disabled phrase falls through to the next occurrence', () => {
		const parsed = parse('Watch Friday Night Lights fri', { disabled: ['friday'] });
		expect(parsed.title).toBe('Watch Friday Night Lights');
		expect(parsed.due).toEqual({ date: '2026-10-16', time: null });
	});
});

test('everything at once', () => {
	const parsed = parse('Submit report #Home fri 4pm p1 remind me 1h before');
	expect(parsed).toEqual({
		title: 'Submit report',
		due: { date: '2026-10-16', time: '16:00' },
		priority: 1,
		reminders: [{ kind: 'before', minutes: 60 }],
		projectId: 'p-home',
		tokens: [
			{ kind: 'project', start: 14, end: 19, text: '#Home' },
			{ kind: 'due', start: 20, end: 27, text: 'fri 4pm' },
			{ kind: 'priority', start: 28, end: 30, text: 'p1' },
			{ kind: 'reminder', start: 31, end: 50, text: 'remind me 1h before' },
		],
	});
});
