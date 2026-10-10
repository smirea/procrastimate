import { describe, expect, test } from 'bun:test';
import { excerpt, search, searchTerms } from './search.ts';
import type { Label, Priority, Project, Task } from './task.ts';

const projects: Project[] = [
	{ id: 'home', name: 'Home', createdAt: 0 },
	{ id: 'garden', name: 'Garden', createdAt: 0 },
	{ id: 'cafe', name: 'Café Ideas', createdAt: 0 },
];
const labels: Label[] = [
	{ id: 'calls', name: 'calls', createdAt: 0 },
	{ id: 'waiting', name: 'Waiting on', createdAt: 0 },
];

let nextId = 0;
const task = (
	title: string,
	{
		notes = '',
		projectId = null,
		labelIds = [],
		priority = 4,
		createdAt = 0,
		completedAt = null,
	}: {
		notes?: string;
		projectId?: string | null;
		labelIds?: string[];
		priority?: Priority;
		createdAt?: number;
		completedAt?: number | null;
	} = {},
): Task => ({
	id: `t${++nextId}`,
	title,
	notes,
	projectId,
	labelIds,
	due: null,
	recurrence: null,
	priority,
	reminders: [],
	createdAt,
	completedAt,
});

const titles = (query: string, tasks: Task[]) => {
	const results = search(query, tasks, { projects, labels });
	return { open: results.open.map(h => h.task.title), completed: results.completed.map(h => h.task.title) };
};

describe('searchTerms', () => {
	test('splits on whitespace and folds case and accents', () => {
		expect(searchTerms('  Café   CRÈME ')).toEqual(['cafe', 'creme']);
	});
});

describe('search matching', () => {
	const tasks = [
		task('Buy milk'),
		task('Water plants', { notes: 'The ferns by the window' }),
		task('Fix sink', { projectId: 'home' }),
		task('Résumé update'),
		task('Pay rent'),
	];

	test('an empty query matches nothing', () => {
		expect(search('   ', tasks, { projects, labels })).toEqual({ projects: [], labels: [], open: [], completed: [] });
	});

	test('matches titles, notes, and project names case-insensitively', () => {
		expect(titles('MILK', tasks).open).toEqual(['Buy milk']);
		expect(titles('ferns', tasks).open).toEqual(['Water plants']);
		expect(titles('home', tasks).open).toEqual(['Fix sink']);
	});

	test('ignores accents on either side', () => {
		expect(titles('resume', tasks).open).toEqual(['Résumé update']);
		expect(search('cafe', [], { projects, labels }).projects.map(h => h.item.name)).toEqual(['Café Ideas']);
		expect(search('café', [], { projects, labels }).projects.map(h => h.item.name)).toEqual(['Café Ideas']);
	});

	test('every term must match, in any field and any order', () => {
		expect(titles('sink home', tasks).open).toEqual(['Fix sink']);
		expect(titles('window water', tasks).open).toEqual(['Water plants']);
		expect(titles('sink garden', tasks).open).toEqual([]);
	});

	test('matches inside a word, but a single letter only at a word start', () => {
		expect(titles('ilk', tasks).open).toEqual(['Buy milk']);
		expect(titles('i', tasks).open).toEqual([]);
		expect(titles('p', tasks).open).toEqual(['Pay rent', 'Water plants']);
	});
});

describe('search ranking', () => {
	test('a title match outranks a project match, which outranks a notes match', () => {
		const tasks = [
			task('Call plumber', { notes: 'about the home warranty' }),
			task('Fix sink', { projectId: 'home' }),
			task('Home insurance'),
		];
		expect(titles('home', tasks).open).toEqual(['Home insurance', 'Fix sink', 'Call plumber']);
	});

	test('a match at the start beats a word start, which beats the middle of a word', () => {
		const tasks = [task('Reprint tickets'), task('Order prints'), task('Print boarding pass')];
		expect(titles('print', tasks).open).toEqual(['Print boarding pass', 'Order prints', 'Reprint tickets']);
	});

	test('ties go to higher priority, then the newest task', () => {
		const tasks = [
			task('Email Sam', { createdAt: 1 }),
			task('Email Alex', { createdAt: 3 }),
			task('Email Jo', { priority: 1, createdAt: 2 }),
		];
		expect(titles('email', tasks).open).toEqual(['Email Jo', 'Email Alex', 'Email Sam']);
	});

	test('completed tasks come back separately, most recently completed first', () => {
		const tasks = [
			task('Renew passport', { completedAt: 100 }),
			task('Passport photos'),
			task('Mail passport form', { completedAt: 300 }),
			task('Book passport appointment', { completedAt: 200 }),
		];
		expect(titles('passport', tasks)).toEqual({
			open: ['Passport photos'],
			completed: ['Mail passport form', 'Book passport appointment', 'Renew passport'],
		});
	});

	test('projects rank by match quality, then name', () => {
		const list: Project[] = [
			{ id: 'a', name: 'Side gardening', createdAt: 0 },
			{ id: 'b', name: 'Garden', createdAt: 0 },
			{ id: 'c', name: 'Allotment garden', createdAt: 0 },
		];
		expect(search('garden', [], { projects: list, labels: [] }).projects.map(h => h.item.name)).toEqual([
			'Garden',
			'Allotment garden',
			'Side gardening',
		]);
	});
});

describe('search highlights', () => {
	test('highlights every occurrence of every term in the original text', () => {
		const [hit] = search('pa re', [task('Pay rent, pay Rex')], { projects, labels }).open;
		expect(hit!.matches.title).toEqual([
			{
				text: 'Pay rent, pay Rex',
				ranges: [
					[0, 2],
					[4, 6],
					[10, 12],
					[14, 16],
				],
			},
		]);
	});

	test('maps folded matches back to accented characters', () => {
		const [hit] = search('resume', [task('My Résumé')], { projects, labels }).open;
		expect(hit!.matches.title).toEqual([{ text: 'My Résumé', ranges: [[3, 9]] }]);
	});

	test('reports the project and notes it matched, and skips fields it did not', () => {
		const [hit] = search('home', [task('Fix sink', { projectId: 'home', notes: 'Call home first' })], {
			projects,
			labels,
		}).open;
		expect(hit!.matches).toEqual({
			project: [{ text: 'Home', ranges: [[0, 4]] }],
			notes: [{ text: 'Call home first', ranges: [[5, 9]] }],
		});
	});

	test('merges overlapping matches', () => {
		const [hit] = search('milk ilk', [task('Buy milk')], { projects, labels }).open;
		expect(hit!.matches.title).toEqual([{ text: 'Buy milk', ranges: [[4, 8]] }]);
	});
});

describe('labels', () => {
	test('a label name matches its tasks and the label itself', () => {
		const tasks = [
			task('Plumber', { labelIds: ['calls'] }),
			task('Dentist', { labelIds: ['waiting', 'calls'] }),
			task('Read'),
		];
		const results = search('call', tasks, { projects, labels });
		expect(results.labels.map(h => [h.item.name, h.name.ranges])).toEqual([['calls', [[0, 4]]]]);
		expect(results.open.map(h => h.task.title)).toEqual(['Plumber', 'Dentist']);
		expect(results.open[1]!.matches).toEqual({ labels: [{ text: 'calls', ranges: [[0, 4]] }] });
	});

	test('a word can match a label while another matches the title', () => {
		const tasks = [task('Dentist', { labelIds: ['waiting'] }), task('Dentist appointment')];
		expect(titles('dentist waiting', tasks).open).toEqual(['Dentist']);
	});

	test('a label match outweighs a notes match and loses to a title match', () => {
		const tasks = [
			task('Plan', { notes: 'calls to make' }),
			task('Plan', { labelIds: ['calls'], createdAt: -1 }),
			task('Calls list'),
		];
		expect(
			search('calls', tasks, { projects, labels }).open.map(h => h.task.notes || h.task.labelIds[0] || h.task.title),
		).toEqual(['Calls list', 'calls', 'calls to make']);
	});

	test('a deleted label no longer matches', () => {
		expect(titles('calls', [task('Plumber', { labelIds: ['gone'] })]).open).toEqual([]);
	});
});

describe('excerpt', () => {
	test('keeps a short lead as is', () => {
		expect(excerpt({ text: 'Call the ferns', ranges: [[9, 14]] })).toEqual({
			text: 'Call the ferns',
			ranges: [[9, 14]],
		});
	});

	test('starts a long text at a word boundary before the first match and shifts the ranges', () => {
		const text = 'Remember to bring the big watering can and then water the ferns by the window';
		expect(excerpt({ text, ranges: [[58, 63]] })).toEqual({
			text: '…can and then water the ferns by the window',
			ranges: [[24, 29]],
		});
	});
});
