import { expect } from 'bun:test';
import * as markdown from './markdown.ts';
import type { Task } from './task.ts';
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

describe('toMarkdown', () => {
	test('a task is its title with its notes nested under it, and none of its dates, priority, project, or labels', () => {
		const pay = task('Pay rent', {
			due: { date: '2026-10-15', time: '09:00' },
			recurrence: { interval: 1, unit: 'month' },
			priority: 1,
			projectId: 'work',
			labelIds: ['home'],
			notes: 'Transfer from savings\r\n\nRef 42  \n- ask Ann\n  - about the deposit\n1. then pay',
		});
		expect(toMarkdown({ title: null, sections: [{ heading: null, tasks: [pay] }] }, [pay])).toBe(
			[
				'- Pay rent',
				'  - Transfer from savings',
				'  - Ref 42',
				'  - ask Ann',
				'    - about the deposit',
				'  1. then pay',
			].join('\n'),
		);
	});

	test('subtasks nest under their parent after its notes, done ones too, and are not repeated at the top level', () => {
		const trip = task('Plan trip', { notes: 'Lisbon in May' });
		const book = task('Book flights', { parentId: 'Plan trip', order: 1 });
		const pack = task('Pack', { parentId: 'Plan trip', order: 0, completedAt: 5 });
		const socks = task('Socks', { parentId: 'Pack' });
		const document = {
			title: 'Inbox',
			sections: [
				{ heading: 'Today', tasks: [trip] },
				{ heading: 'Friday', tasks: [book] },
			],
		};
		expect(toMarkdown(document, [trip, book, pack, socks])).toBe(
			[
				'# Inbox',
				'',
				'## Today',
				'',
				'- Plan trip',
				'  - Lisbon in May',
				'  - Pack',
				'    - Socks',
				'  - Book flights',
			].join('\n'),
		);
	});

	test('a subtask copied without its parent stands on its own', () => {
		const trip = task('Plan trip');
		const book = task('Book flights', { parentId: 'Plan trip' });
		expect(toMarkdown({ title: null, sections: [{ heading: 'Tomorrow', tasks: [book] }] }, [trip, book])).toBe(
			'## Tomorrow\n\n- Book flights',
		);
	});

	test('a view with nothing in it is only its title', () => {
		expect(toMarkdown({ title: 'No date', sections: [{ heading: null, tasks: [] }] }, [])).toBe('# No date');
	});

	test('a project copies its loose tasks first, then each section with tasks under its name', () => {
		const work = { id: 'work', name: 'Work', order: 0, createdAt: 0 };
		const section = (id: string, name: string) => ({ id, projectId: 'work', name, order: 0, createdAt: 0 });
		const loose = task('Inbox zero', { projectId: 'work' });
		const next = task('Ship it', { projectId: 'work', sectionId: 'next' });
		const document = projectDocument(work, [
			{ section: null, tasks: [loose] },
			{ section: section('next', 'Next up'), tasks: [next] },
			{ section: section('later', 'Later'), tasks: [] },
		]);
		expect(toMarkdown(document, [loose, next])).toBe('# Work\n\n- Inbox zero\n\n## Next up\n\n- Ship it');
	});
});
