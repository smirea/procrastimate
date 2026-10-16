import { expect } from 'bun:test';
import * as markdown from './markdown.ts';
import type { DateKey, Label, Task } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const toMarkdown = recorded('markdown', markdown.toMarkdown);
const projectDocument = recorded('markdown', markdown.projectDocument);

let created = 0;
const task = (id: string, fields: Partial<Task> = {}): Task => ({
	id,
	parentId: null,
	order: 0,
	title: id,
	notes: '',
	projectId: null,
	sectionId: null,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	location: null,
	event: null,
	images: [],
	createdAt: ++created,
	completedAt: null,
	createdBy: null,
	completedBy: null,
	lastCompletedAt: null,
	...fields,
});

// Wednesday, October 14 2026.
const today: DateKey = '2026-10-14';
const projects = [{ id: 'work', name: 'Work', order: 0, createdAt: 0 }];
const labels: Label[] = [
	{ id: 'home', name: 'home', color: 'gray', createdAt: 0 },
	{ id: 'deep', name: 'deep work', color: 'gray', createdAt: 0 },
];

describe('toMarkdown', () => {
	test('a task lists its due, repeat, priority, project, labels, and notes', () => {
		const pay = task('Pay rent', {
			due: { date: '2026-10-15', time: '09:00' },
			recurrence: { interval: 1, unit: 'month' },
			priority: 1,
			projectId: 'work',
			labelIds: ['home', 'deep', 'gone'],
			notes: 'Transfer from savings\r\n\nRef 42  ',
		});
		const context = { tasks: [pay], projects, labels, today };
		expect(toMarkdown({ title: null, projectId: null, sections: [{ heading: null, tasks: [pay] }] }, context)).toBe(
			[
				'- [ ] Pay rent · Tomorrow 9am · Every month · p1 · #Work · @home · @deep work',
				'  Transfer from savings',
				'',
				'  Ref 42',
			].join('\n'),
		);
	});

	test('the project a copy comes from is not repeated on its rows', () => {
		const write = task('Write spec', { projectId: 'work' });
		const context = { tasks: [write], projects, labels, today };
		expect(
			toMarkdown({ title: 'Work', projectId: 'work', sections: [{ heading: null, tasks: [write] }] }, context),
		).toBe('# Work\n\n- [ ] Write spec');
	});

	test('subtasks nest under their parent, done ones checked, and are not repeated at the top level', () => {
		const trip = task('Plan trip', { due: { date: today, time: null } });
		const book = task('Book flights', { parentId: 'Plan trip', order: 1, due: { date: '2026-10-16', time: null } });
		const pack = task('Pack', { parentId: 'Plan trip', order: 0, completedAt: 5 });
		const socks = task('Socks', { parentId: 'Pack' });
		const context = { tasks: [trip, book, pack, socks], projects, labels, today };
		const document = {
			title: 'Inbox',
			projectId: null,
			sections: [
				{ heading: 'Today', tasks: [trip] },
				{ heading: 'Friday', tasks: [book] },
			],
		};
		expect(toMarkdown(document, context)).toBe(
			[
				'# Inbox',
				'',
				'## Today',
				'',
				'- [ ] Plan trip · Today',
				'  - [x] Pack',
				'    - [ ] Socks',
				'  - [ ] Book flights · Friday',
			].join('\n'),
		);
	});

	test('a subtask copied without its parent stands on its own', () => {
		const trip = task('Plan trip');
		const book = task('Book flights', { parentId: 'Plan trip', projectId: 'work' });
		const context = { tasks: [trip, book], projects, labels, today };
		expect(
			toMarkdown({ title: null, projectId: null, sections: [{ heading: 'Tomorrow', tasks: [book] }] }, context),
		).toBe('## Tomorrow\n\n- [ ] Book flights');
	});

	test('a view with nothing in it is only its title', () => {
		const context = { tasks: [], projects, labels, today };
		expect(toMarkdown({ title: 'No date', projectId: null, sections: [{ heading: null, tasks: [] }] }, context)).toBe(
			'# No date',
		);
	});

	test('a project copies its loose tasks first, then each section with tasks under its name', () => {
		const work = projects[0]!;
		const section = (id: string, name: string) => ({ id, projectId: 'work', name, order: 0, createdAt: 0 });
		const loose = task('Inbox zero', { projectId: 'work' });
		const next = task('Ship it', { projectId: 'work', sectionId: 'next' });
		const document = projectDocument(work, [
			{ section: null, tasks: [loose] },
			{ section: section('next', 'Next up'), tasks: [next] },
			{ section: section('later', 'Later'), tasks: [] },
		]);
		expect(toMarkdown(document, { tasks: [loose, next], projects, labels, today })).toBe(
			'# Work\n\n- [ ] Inbox zero\n\n## Next up\n\n- [ ] Ship it',
		);
	});
});
