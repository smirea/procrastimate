import { expect } from 'bun:test';
import * as quickAdd from './quick-add.ts';
import type { ParseOptions } from './quick-add.ts';
import type { Label } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const parseQuickAdd = recorded('quick-add', quickAdd.parseQuickAdd);

// Wednesday, October 14 2026, 10:00 local time.
const now = new Date(2026, 9, 14, 10, 0);
const projects = [
	{ id: 'p-home', name: 'Home', createdAt: 0 },
	{ id: 'p-side', name: 'Side Project', createdAt: 0 },
];
const labels: Label[] = [
	{ id: 'l-calls', name: 'calls', color: 'gray', createdAt: 0 },
	{ id: 'l-waiting', name: 'Waiting', color: 'gray', createdAt: 0 },
	{ id: 'l-deep', name: 'deep work', color: 'gray', createdAt: 0 },
	{ id: 'l-tom', name: 'tom', color: 'gray', createdAt: 0 },
];
const parse = (input: string, options: Partial<ParseOptions> = {}) =>
	parseQuickAdd(input, { now, projects, labels, ...options });

test('token ranges are UTF-16 offsets past accents and emoji', () => {
	const parsed = parse('Café ☕ réunion tomorrow 9am 🎉 p1');
	expect(parsed.title).toBe('Café ☕ réunion 🎉');
	expect(parsed.tokens).toEqual([
		{ kind: 'due', start: 15, end: 27, text: 'tomorrow 9am' },
		{ kind: 'priority', start: 31, end: 33, text: 'p1' },
	]);
});

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

	test('an absolute reminder time lands on a due date set outside the text', () => {
		const parsed = parse('Call mom remind me at 9am', { due: { date: '2026-10-15', time: null } });
		expect(parsed.due).toBe(null);
		expect(parsed.reminders).toEqual([{ kind: 'at', date: '2026-10-15', time: '09:00' }]);
	});

	test('a due date in the text beats the one set outside it', () => {
		const parsed = parse('Call mom fri remind me at 9am', { due: { date: '2026-10-15', time: null } });
		expect(parsed.reminders).toEqual([{ kind: 'at', date: '2026-10-16', time: '09:00' }]);
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

	test('a project name with regex characters matches literally', () => {
		const car = { id: 'p-car', name: 'Car (2) [old]', createdAt: 0 };
		const parsed = parse('Fix brakes #car (2) [old] fri', { projects: [...projects, car] });
		expect(parsed.title).toBe('Fix brakes');
		expect(parsed.projectId).toBe('p-car');
		expect(parsed.tokens[0]).toEqual({ kind: 'project', start: 11, end: 25, text: '#car (2) [old]' });
	});

	test('an unknown project stays in the title', () => {
		const parsed = parse('Fix sink #garage');
		expect(parsed.title).toBe('Fix sink #garage');
		expect(parsed.projectId).toBe(null);
	});
});

describe('sections', () => {
	const section = (id: string, name: string, projectId: string) => ({ id, projectId, name, order: 0, createdAt: 0 });
	const sections = [
		section('s-home-later', 'Later', 'p-home'),
		section('s-home-next', 'Next up', 'p-home'),
		section('s-side-later', 'later', 'p-side'),
	];

	test('`/name` picks a section of the typed project, case-insensitively', () => {
		const parsed = parse('Fix sink #Home /later fri', { sections });
		expect([parsed.title, parsed.projectId, parsed.sectionId]).toEqual(['Fix sink', 'p-home', 's-home-later']);
		expect(parsed.tokens).toEqual([
			{ kind: 'project', start: 9, end: 14, text: '#Home' },
			{ kind: 'section', start: 15, end: 21, text: '/later' },
			{ kind: 'due', start: 22, end: 25, text: 'fri' },
		]);
		expect(parse('Ship /Later #side project', { sections }).sectionId).toBe('s-side-later');
		expect(parse('Plan /next up', { sections, projectId: 'p-home' }).sectionId).toBe('s-home-next');
	});

	test('without a project, a section of the project set outside the text, else none', () => {
		const parsed = parse('Fix sink /next up', { sections, projectId: 'p-home' });
		expect([parsed.title, parsed.projectId, parsed.sectionId]).toEqual(['Fix sink', null, 's-home-next']);
		expect(parse('Fix sink /later', { sections }).title).toBe('Fix sink /later');
	});

	test('a section of another project, a slash inside a word, and a path stay text', () => {
		expect(parse('Fix sink #Home /someday', { sections }).title).toBe('Fix sink /someday');
		expect(parse('Pick and/later tomorrow', { sections, projectId: 'p-home' }).title).toBe('Pick and/later');
		expect(parse('Clean /later/cache', { sections, projectId: 'p-home' }).sectionId).toBe(null);
	});
});

describe('labels', () => {
	test('every known label is assigned, case-insensitively and in any project', () => {
		const parsed = parse('Call plumber @Calls #home @waiting');
		expect(parsed.title).toBe('Call plumber');
		expect(parsed.labelIds).toEqual(['l-calls', 'l-waiting']);
		expect(parsed.projectId).toBe('p-home');
		expect(parsed.tokens).toEqual([
			{ kind: 'label', start: 13, end: 19, text: '@Calls' },
			{ kind: 'project', start: 20, end: 25, text: '#home' },
			{ kind: 'label', start: 26, end: 34, text: '@waiting' },
		]);
	});

	test('a label at the start, a multi-word label, and a repeated label', () => {
		const parsed = parse('@deep work Write spec @calls fri @CALLS');
		expect(parsed.title).toBe('Write spec');
		expect(parsed.labelIds).toEqual(['l-deep', 'l-calls']);
		expect(parsed.due).toEqual({ date: '2026-10-16', time: null });
	});

	test('a label named like a date word is a label, not a date', () => {
		const parsed = parse('Lunch @tom');
		expect(parsed.labelIds).toEqual(['l-tom']);
		expect(parsed.due).toBe(null);
	});

	test.each([
		['Email bob@calls.com', 'Email bob@calls.com'],
		['Ask x@calls', 'Ask x@calls'],
		['Reply @calls.com', 'Reply @calls.com'],
		['Reply to @callsign', 'Reply to @callsign'],
		['Ping @garage', 'Ping @garage'],
		['Thank you@calls', 'Thank you@calls'],
	])('%p stays text', (input, title) => {
		const parsed = parse(input);
		expect(parsed.title).toBe(title);
		expect(parsed.labelIds).toEqual([]);
		expect(parsed.tokens).toEqual([]);
	});

	test.each(['Ask @tomorrow', 'Ping @5pm', 'DM @p1', 'Ping @urgent', 'Meet @fri'].map(input => [input] as const))(
		'a handle in %p never reads as a date or priority',
		input => {
			const parsed = parse(input);
			expect(parsed.title).toBe(input);
			expect(parsed.tokens).toEqual([]);
		},
	);

	test('a trailing comma or period still ends the label', () => {
		expect(parse('Call mom @calls, then dad').labelIds).toEqual(['l-calls']);
		expect(parse('Call mom @calls.').labelIds).toEqual(['l-calls']);
	});

	test('with no labels, @words stay text', () => {
		expect(parse('Call @calls', { labels: [] }).title).toBe('Call @calls');
	});
});

describe('shorthands', () => {
	test.each([
		['5m', '2026-10-14', '10:05'],
		['5min', '2026-10-14', '10:05'],
		['5mins', '2026-10-14', '10:05'],
		['5 mins', '2026-10-14', '10:05'],
		['in 5m', '2026-10-14', '10:05'],
		['in 30', '2026-10-14', '10:30'],
		['in 30 minutes', '2026-10-14', '10:30'],
		['2h', '2026-10-14', '12:00'],
		['2hr', '2026-10-14', '12:00'],
		['2hrs', '2026-10-14', '12:00'],
		['2 hrs', '2026-10-14', '12:00'],
		['in 2 hours', '2026-10-14', '12:00'],
		['in 15h', '2026-10-15', '01:00'],
		['2d', '2026-10-16', null],
		['1w', '2026-10-21', null],
		['2wk', '2026-10-28', null],
		['3mo', '2027-01-14', null],
		['in 3 months', '2027-01-14', null],
		['in 1 year', '2027-10-14', null],
		['2d 5pm', '2026-10-16', '17:00'],
		['tom', '2026-10-15', null],
		['tmr', '2026-10-15', null],
		['tmrw', '2026-10-15', null],
		['tom 9am', '2026-10-15', '09:00'],
		['5p', '2026-10-14', '17:00'],
		['5pm', '2026-10-14', '17:00'],
		['5 pm', '2026-10-14', '17:00'],
		['5:30p', '2026-10-14', '17:30'],
		['11a', '2026-10-14', '11:00'],
		['17:30', '2026-10-14', '17:30'],
		['1730', '2026-10-14', '17:30'],
		['at 2030', '2026-10-14', '20:30'],
		['fri 5p', '2026-10-16', '17:00'],
		['mon', '2026-10-19', null],
		['tue', '2026-10-20', null],
		['wed', '2026-10-14', null],
		['thu', '2026-10-15', null],
		['sat', '2026-10-17', null],
		['sun', '2026-10-18', null],
		['next fri', '2026-10-23', null],
		['nxt fri', '2026-10-23', null],
		['tonight', '2026-10-14', '20:00'],
		['eod', '2026-10-14', '17:00'],
		['eow', '2026-10-16', '17:00'],
		['noon', '2026-10-14', '12:00'],
		['midnight', '2026-10-15', '00:00'],
		['10/15', '2026-10-15', null],
		['15/10', '2026-10-15', null],
		['10/13', '2027-10-13', null],
		['3/4', '2027-03-04', null],
		['10/15/2027', '2027-10-15', null],
		['15 oct', '2026-10-15', null],
		['oct 15', '2026-10-15', null],
		['the 15th', '2026-10-15', null],
		['the 13th', '2026-11-13', null],
		['on the 31st', '2026-10-31', null],
	])('Pay rent %s', (phrase, date, time) => {
		const parsed = parse(`Pay rent ${phrase}`);
		expect(parsed.title).toBe('Pay rent');
		expect<unknown>(parsed.due).toEqual({ date, time });
	});
});

describe('a time with no day', () => {
	test.each([
		['9am', '2026-10-15', '09:00'],
		['9:59am', '2026-10-15', '09:59'],
		['10am', '2026-10-14', '10:00'],
		['10:01am', '2026-10-14', '10:01'],
		['wed 9am', '2026-10-14', '09:00'],
	])('%s lands on the next time it comes around unless a day is typed', (phrase, date, time) => {
		expect<unknown>(parse(`Stretch ${phrase}`).due).toEqual({ date, time });
	});

	test('a time alone keeps the date set outside the text', () => {
		const parsed = parse('Call mom 9am', { due: { date: '2026-10-16', time: null } });
		expect(parsed.due).toEqual({ date: '2026-10-16', time: '09:00' });
	});

	test.each([
		['2026-10-14', '9am', '2026-10-15', '09:00'],
		['2026-10-14', '11am', '2026-10-14', '11:00'],
		['2026-10-10', '9am', '2026-10-15', '09:00'],
		['2026-10-10', '11am', '2026-10-14', '11:00'],
	])('a time alone on the outside date %s never lands in the past: %s', (outside, phrase, date, time) => {
		expect<unknown>(parse(`Call mom ${phrase}`, { due: { date: outside, time: null } }).due).toEqual({ date, time });
	});

	test('a typed day keeps a past time even with a date set outside the text', () => {
		const parsed = parse('Call mom today 9am', { due: { date: '2026-10-14', time: null } });
		expect(parsed.due).toEqual({ date: '2026-10-14', time: '09:00' });
	});

	test('a repeat on the outside date moves past a time that has passed', () => {
		const parsed = parse('Water plants every day 9am', { due: { date: '2026-10-14', time: null } });
		expect(parsed.due).toEqual({ date: '2026-10-15', time: '09:00' });
	});

	test('an absolute reminder time that has passed lands tomorrow', () => {
		const parsed = parse('Water plants remind me at 9am');
		expect(parsed.reminders).toEqual([{ kind: 'at', date: '2026-10-15', time: '09:00' }]);
	});
});

describe('dates with a month name', () => {
	test.each([
		['October 20', '2026-10-20', null],
		['OCT 20', '2026-10-20', null],
		['october 3rd', '2027-10-03', null],
		['Dec. 25', '2026-12-25', null],
		['Sept. 30', '2027-09-30', null],
		['sept 30th', '2027-09-30', null],
		['20th of October', '2026-10-20', null],
		['the 1st of December', '2026-12-01', null],
		['on the 3rd of november', '2026-11-03', null],
		['October the 20th', '2026-10-20', null],
		['20th of October, 2027', '2027-10-20', null],
		['Monday, October 19', '2026-10-19', null],
		['tue oct 20', '2026-10-20', null],
		['Oct 19, 10am', '2026-10-19', '10:00'],
		['October 20th, 2027, 3pm', '2027-10-20', '15:00'],
		['October 2nd at 3pm', '2027-10-02', '15:00'],
		['3pm, Oct 20', '2026-10-20', '15:00'],
	])('Pay rent %s', (phrase, date, time) => {
		const parsed = parse(`Pay rent ${phrase}`);
		expect(parsed.title).toBe('Pay rent');
		expect<unknown>(parsed.due).toEqual({ date, time });
	});

	test('punctuation after a removed date stays on the title', () => {
		expect(parse('Pay rent October 20th.').title).toBe('Pay rent.');
		expect(parse('Call mom tomorrow, then buy milk').title).toBe('Call mom, then buy milk');
	});

	test('a month name that is not a date stays text', () => {
		expect(parse('Book flights for December').due).toBeNull();
		expect(parse('Read chapter 3 of may').title).toBe('Read chapter 3 of may');
	});

	test('a month name date spoken with commas parses', () => {
		const parsed = parse('Dentist on Monday, October 19th, at 3pm.', { spoken: true });
		expect(parsed.title).toBe('Dentist.');
		expect(parsed.due).toEqual({ date: '2026-10-19', time: '15:00' });
	});

	test('a month name date with no such day stays text', () => {
		expect(parse('Party the 30th of february').due).toBeNull();
	});
});

describe('dates with a year', () => {
	test.each([
		['Jun 21 2027', '2027-06-21'],
		['May 23, 2027', '2027-05-23'],
		['21 june 2027', '2027-06-21'],
		['15th october, 2028', '2028-10-15'],
		['Dec 4', '2026-12-04'],
		['Oct 22', '2026-10-22'],
		['Oct 13', '2027-10-13'],
	])('Renew passport %s', (phrase, date) => {
		const parsed = parse(`Renew passport ${phrase}`);
		expect(parsed.title).toBe('Renew passport');
		expect<unknown>(parsed.due).toEqual({ date, time: null });
	});

	test('a year and a time both apply', () => {
		expect(parse('Flight Jun 21 2027 11am').due).toEqual({ date: '2027-06-21', time: '11:00' });
	});

	test('a time after at still reads as a time, not a year', () => {
		expect(parse('Dinner oct 15 at 2030').due).toEqual({ date: '2026-10-15', time: '20:30' });
	});

	test('a year without a month and day stays text', () => {
		const parsed = parse('Order 2027 calendars');
		expect(parsed.due).toBeNull();
		expect(parsed.title).toBe('Order 2027 calendars');
	});

	test('the last day of 9999 still reads as a date', () => {
		expect(parse('Far off 2912156d').due).toEqual({ date: '9999-12-31', time: null });
	});

	test.each([
		['Nudged task 2912157d'],
		['Nudged task 3929284d'],
		['Nudged task 99999999999999999999d'],
		['Nudged task in 8000 years'],
		['Nudged task 99999999999999w'],
		['Nudged task 9999999999h'],
		['Nudged task remind me in 99999999999999999999 days'],
	])('a date past the year 9999 stays text: %s', input => {
		const parsed = parse(input);
		expect(parsed.title).toBe(input);
		expect(parsed.due).toBeNull();
		expect(parsed.reminders).toEqual([]);
	});
});

describe('recurrence', () => {
	test.each([
		['every day', 1, 'day', '2026-10-14', null],
		['daily', 1, 'day', '2026-10-14', null],
		['weekly', 1, 'week', '2026-10-14', null],
		['monthly', 1, 'month', '2026-10-14', null],
		['yearly', 1, 'year', '2026-10-14', null],
		['every week', 1, 'week', '2026-10-14', null],
		['every mon', 1, 'week', '2026-10-19', null],
		['every monday', 1, 'week', '2026-10-19', null],
		['every 2d', 2, 'day', '2026-10-14', null],
		['every 2 weeks', 2, 'week', '2026-10-14', null],
		['every 3mo', 3, 'month', '2026-10-14', null],
		['every other week', 2, 'week', '2026-10-14', null],
		['every day 5pm', 1, 'day', '2026-10-14', '17:00'],
		['every day 9am', 1, 'day', '2026-10-15', '09:00'],
		['every 2d at 9am', 2, 'day', '2026-10-16', '09:00'],
		['every wed 9am', 1, 'week', '2026-10-21', '09:00'],
		['9am every mon', 1, 'week', '2026-10-19', '09:00'],
		['every fri oct 30', 1, 'week', '2026-10-30', null],
		['every weekday', 1, 'weekday', '2026-10-14', null],
		['every workday', 1, 'weekday', '2026-10-14', null],
		['weekdays', 1, 'weekday', '2026-10-14', null],
		['every weekday 9am', 1, 'weekday', '2026-10-15', '09:00'],
		['every March 2nd 11 am', 1, 'year', '2027-03-02', '11:00'],
		['every May 13 11 am', 1, 'year', '2027-05-13', '11:00'],
		['every 2nd march', 1, 'year', '2027-03-02', null],
		['every oct 14', 1, 'year', '2026-10-14', null],
		['every oct 14 9am', 1, 'year', '2027-10-14', '09:00'],
		['every dec 25', 1, 'year', '2026-12-25', null],
	])('Water plants %s', (phrase, interval, unit, date, time) => {
		const parsed = parse(`Water plants ${phrase}`);
		expect(parsed.title).toBe('Water plants');
		expect<unknown>(parsed.recurrence).toEqual({ interval, unit });
		expect<unknown>(parsed.due).toEqual({ date, time });
	});

	test('an earlier repeat stays in the title and the last one sets the first date', () => {
		const parsed = parse('Water every mon every fri');
		expect(parsed.title).toBe('Water every mon');
		expect(parsed.recurrence).toEqual({ interval: 1, unit: 'week' });
		expect(parsed.due).toEqual({ date: '2026-10-16', time: null });
	});

	test('a repeat without a weekday starts on the date set outside the text', () => {
		const parsed = parse('Water plants every week', { due: { date: '2026-10-20', time: '08:00' } });
		expect(parsed.due).toEqual({ date: '2026-10-20', time: '08:00' });
	});

	test('a weekday repeat keeps its weekday over the date set outside the text', () => {
		const parsed = parse('Water plants every mon', { due: { date: '2026-10-14', time: null } });
		expect(parsed.due).toEqual({ date: '2026-10-19', time: null });
	});

	test('a weekday repeat typed on a weekend starts on Monday', () => {
		const parsed = parse('Standup every weekday 9am', { now: new Date(2026, 9, 17, 8, 0) });
		expect(parsed.recurrence).toEqual({ interval: 1, unit: 'weekday' });
		expect(parsed.due).toEqual({ date: '2026-10-19', time: '09:00' });
	});

	test('a weekday repeat at a passed time on a Friday moves to Monday', () => {
		expect(parse('Standup every weekday 9am', { now: new Date(2026, 9, 16, 10, 0) }).due).toEqual({
			date: '2026-10-19',
			time: '09:00',
		});
	});

	test.each([
		['gym mon wed fri 7am', [1, 3, 5], '2026-10-16', '07:00'],
		['gym 7am mon wed fri', [1, 3, 5], '2026-10-16', '07:00'],
		['gym mon wed fri at 11am', [1, 3, 5], '2026-10-14', '11:00'],
		['gym every mon, wed', [1, 3], '2026-10-14', null],
		['gym every mon and fri', [1, 5], '2026-10-16', null],
		['gym every mon, wed, and fri', [1, 3, 5], '2026-10-14', null],
		['gym every Mon & Thu', [1, 4], '2026-10-15', null],
		['gym every monday, wednesday, friday 7am', [1, 3, 5], '2026-10-16', '07:00'],
		['gym every fri mon', [1, 5], '2026-10-16', null],
		['gym tue/thu', [2, 4], '2026-10-15', null],
		['gym tue / thu 6pm', [2, 4], '2026-10-15', '18:00'],
		['gym sat sun 9am', [6, 0], '2026-10-17', '09:00'],
		['gym every sat and sun', [6, 0], '2026-10-17', null],
		['gym mon, wed and fri at 6pm', [1, 3, 5], '2026-10-14', '18:00'],
	] as const)('%s repeats on a weekday set', (input, days, date, time) => {
		const parsed = parse(input);
		expect(parsed.title).toBe('gym');
		expect<unknown>(parsed.recurrence).toEqual({ interval: 1, unit: 'week', days });
		expect<unknown>(parsed.due).toEqual({ date, time });
	});

	test.each([
		['every mon wed workout', [1, 3]],
		['7am mon wed workout', [1, 3]],
		['tue/wed workout', [2, 3]],
		['every fri, sat workout', [5, 6]],
	] as const)('%s keeps its last weekday before an ordinary word', (input, days) => {
		const parsed = parse(input);
		expect(parsed.title).toBe('workout');
		expect<unknown>(parsed.recurrence).toEqual({ interval: 1, unit: 'week', days });
	});

	test('a weekday list that names one day is a plain weekly repeat', () => {
		expect(parse('gym every mon, monday').recurrence).toEqual({ interval: 1, unit: 'week' });
	});

	test('a typed date moves to the first listed weekday on or after it', () => {
		expect(parse('gym every mon, wed oct 20').due).toEqual({ date: '2026-10-21', time: null });
	});

	test('a weekday set keeps its first day over the date set outside the text', () => {
		const parsed = parse('gym tue/thu', { due: { date: '2026-10-14', time: '08:00' } });
		expect(parsed.due).toEqual({ date: '2026-10-15', time: null });
	});

	test('a weekday set and its time are separate tokens', () => {
		expect(parse('gym mon wed fri 7am').tokens).toEqual([
			{ kind: 'recurrence', start: 4, end: 15, text: 'mon wed fri' },
			{ kind: 'due', start: 16, end: 19, text: '7am' },
		]);
	});

	test.each(
		[
			'Discuss mon wed plan',
			'Discuss mon wed',
			'mon wed fri',
			'Compare sat, sun options',
			'Swap tue and thu shifts',
		].map(input => [input] as const),
	)('a bare weekday list without a time, every, or a slash stays text: %s', input => {
		const parsed = parse(input);
		expect(parsed.title).toBe(input);
		expect(parsed.due).toBe(null);
		expect(parsed.recurrence).toBe(null);
		expect(parsed.tokens).toEqual([]);
	});

	test('a single weekday next to a time is still a due date, not a repeat', () => {
		const parsed = parse('Lunch fri 12pm');
		expect(parsed.due).toEqual({ date: '2026-10-16', time: '12:00' });
		expect(parsed.recurrence).toBe(null);
	});

	test('a yearly repeat on a day that does not exist stays text', () => {
		const parsed = parse('Party every feb 30');
		expect(parsed.recurrence).toBeNull();
		expect(parsed.title).toBe('Party every feb 30');
	});

	test('the recurrence phrase is its own token', () => {
		expect(parse('Water plants every day 9am').tokens).toEqual([
			{ kind: 'recurrence', start: 13, end: 22, text: 'every day' },
			{ kind: 'due', start: 23, end: 26, text: '9am' },
		]);
	});
});

describe('reminder shorthands', () => {
	test.each([
		['r5m', 5],
		['r30m', 30],
		['r1h', 60],
		['r2d', 2880],
		['r1w', 10_080],
		['remind 5m before', 5],
		['remind me 5 mins before', 5],
	])('%s', (phrase, minutes) => {
		const parsed = parse(`Dentist fri 3pm ${phrase}`);
		expect(parsed.title).toBe('Dentist');
		expect(parsed.due).toEqual({ date: '2026-10-16', time: '15:00' });
		expect(parsed.reminders).toEqual([{ kind: 'before', minutes }]);
	});
});

describe('ordinary words stay in the title', () => {
	test.each(
		[
			'Call Tom',
			'Call tom',
			'Tom birthday gift',
			'Email the report to tom',
			'Watch tom hanks movie',
			'Squeeze lemon',
			'Buy lemons and salmon',
			'Buy sun hat',
			'Fix the chair I sat on',
			'Get wed invitations printed',
			'Apt 5p buzzer is broken',
			'Deliver to 5p Baker St',
			'Room 1730 projector',
			'Pay $1730 deposit',
			'File taxes 2026',
			'2026 budget review',
			'Buy 50p coins',
			'Daily standup notes',
			'Weekly review',
			'Weekdays only gym',
			'Monopoly night',
			'Read 2.5h audiobook',
			'Momentum check',
			'Try ratio 15/14',
			'I sat and waited',
			'Sat and sun bathed',
			'Plan mon wed fri rota',
			'Read https://example.com/5m#Home',
			'Watch https://youtu.be/x?t=10m',
			'See https://x.com/@calls/status/1',
			'Check www.site.com/docs/monday-1pm',
			'Read [p1 notes](https://blog.dev/p1/every-day)',
		].map(input => [input] as const),
	)('%s', input => {
		const parsed = parse(input);
		expect(parsed.title).toBe(input);
		expect(parsed.due).toBe(null);
		expect(parsed.recurrence).toBe(null);
		expect(parsed.tokens).toEqual([]);
	});

	test('a name keeps its case while a later date still parses', () => {
		const parsed = parse('Lunch with Tom tom');
		expect(parsed.title).toBe('Lunch with Tom');
		expect(parsed.due).toEqual({ date: '2026-10-15', time: null });
	});

	test('a word-like shorthand at the end still parses', () => {
		const parsed = parse('Water plants daily');
		expect(parsed.title).toBe('Water plants');
		expect(parsed.recurrence).toEqual({ interval: 1, unit: 'day' });
	});

	test('phrases around a link still parse', () => {
		const parsed = parse('Read https://a.com/5pm #Home fri 9am');
		expect(parsed.title).toBe('Read https://a.com/5pm');
		expect(parsed.due).toEqual({ date: '2026-10-16', time: '09:00' });
		expect(parsed.projectId).toBe('p-home');
	});

	test('months never read as minutes', () => {
		expect(parse('Renew 3mo').due).toEqual({ date: '2027-01-14', time: null });
		expect(parse('Renew 3m').due).toEqual({ date: '2026-10-14', time: '10:03' });
	});
});

test('everything at once', () => {
	const parsed = parse('Submit report #Home fri 4pm p1 remind me 1h before');
	expect(parsed).toEqual({
		title: 'Submit report',
		due: { date: '2026-10-16', time: '16:00' },
		recurrence: null,
		priority: 1,
		reminders: [{ kind: 'before', minutes: 60 }],
		projectId: 'p-home',
		sectionId: null,
		labelIds: [],
		tokens: [
			{ kind: 'project', start: 14, end: 19, text: '#Home' },
			{ kind: 'due', start: 20, end: 27, text: 'fri 4pm' },
			{ kind: 'priority', start: 28, end: 30, text: 'p1' },
			{ kind: 'reminder', start: 31, end: 50, text: 'remind me 1h before' },
		],
	});
});

describe('spoken', () => {
	const spoken = (input: string) => parse(input, { spoken: true });

	test.each([
		['This is urgent call the bank', 'This is urgent call the bank'],
		['Important call the bank', 'Important call the bank'],
		['Call the bank !!!', 'Call the bank !!!'],
		['Call the bank !!', 'Call the bank !!'],
	])('priority words stay text: %s', (input, title) => {
		const parsed = spoken(input);
		expect(parsed.title).toBe(title);
		expect(parsed.priority).toBe(null);
	});

	test('a priority level still counts', () => {
		expect(spoken('Call the bank p2').priority).toBe(2);
	});

	test.each([['Call 1800 flowers'], ['Order 1730 widgets'], ['Call 1800 flowers tomorrow']])(
		'a bare four-digit number is not a time: %s',
		input => {
			const parsed = spoken(input);
			expect(parsed.due?.time ?? null).toBe(null);
		},
	);

	test('a four-digit time after at still counts', () => {
		expect(spoken('Leave at 1730').due).toEqual({ date: '2026-10-14', time: '17:30' });
	});

	test('a year after a date still counts', () => {
		expect(spoken('Meet June 21, 2027').due).toEqual({ date: '2027-06-21', time: null });
	});

	test.each([
		['Order 5M screws'],
		['Run 5m'],
		['Plank 2h'],
		['Rest 2d'],
		['Wait 1w'],
		['Plan 3mo'],
		['Study 5 mins'],
		['Split in 2 groups'],
		['Call mom r5m'],
		['Call mom remind me 30m before'],
	])('compact units do not apply: %s', input => {
		const parsed = spoken(input);
		expect(parsed.title).toBe(input);
		expect(parsed.due).toBe(null);
		expect(parsed.reminders).toEqual([]);
	});

	test.each([
		['in 10 minutes', { date: '2026-10-14', time: '10:10' }],
		['in 2 hours', { date: '2026-10-14', time: '12:00' }],
		['in 5 mins', { date: '2026-10-14', time: '10:05' }],
		['in 2 weeks', { date: '2026-10-28', time: null }],
	])('spelled-out units still count: %s', (phrase, due) => {
		expect(spoken(`Call mom ${phrase}`).due).toEqual(due);
	});

	test('reminders with spelled-out units still count', () => {
		expect(spoken('Call mom tomorrow 5pm remind me 30 minutes before').reminders).toEqual([
			{ kind: 'before', minutes: 30 },
		]);
	});

	test.each([
		["Review Tuesday's notes"],
		['Review Tuesday’s notes'],
		["Prep today's agenda"],
		["Read tomorrow's brief"],
	])('a day with apostrophe s stays text: %s', input => {
		const parsed = spoken(input);
		expect(parsed.title).toBe(input);
		expect(parsed.due).toBe(null);
	});

	test('an ordinal before a word is not a date', () => {
		const parsed = spoken('Read the 5th chapter');
		expect(parsed.title).toBe('Read the 5th chapter');
		expect(parsed.due).toBe(null);
	});

	test('an ordinal at the end is still a date', () => {
		expect(spoken('Pay rent on the 15th').due).toEqual({ date: '2026-10-15', time: null });
	});

	test('typed quick add keeps its shorthands', () => {
		const parsed = parse("Review Tuesday's notes urgent 5m");
		expect(parsed.priority).toBe(1);
		expect(parsed.due).toEqual({ date: '2026-10-14', time: '10:05' });
	});
});
