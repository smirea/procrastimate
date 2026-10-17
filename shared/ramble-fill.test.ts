import { expect } from 'bun:test';
import { parseRamble } from './ramble.ts';
import * as fill from './ramble-fill.ts';
import type { RambleTask } from './ramble.ts';
import { NO_DEFAULTS } from './screens.ts';
import type { TaskEvent, TaskLocation } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';

const rambleNewTask = recorded('ramble-fill', fill.rambleNewTask);

const now = new Date(1791986400000);

function task(title: string, extra: Partial<RambleTask> = {}): RambleTask {
	return {
		segment: { start: 0, end: title.length },
		title,
		notes: '',
		due: null,
		recurrence: null,
		priority: null,
		reminders: [],
		projectId: null,
		labelIds: [],
		subtasks: [],
		...extra,
	};
}

describe('rambleNewTask', () => {
	test('keeps the title and every field the grammar read', () => {
		const [spoken] = parseRamble('Call mom tomorrow at five p.m. priority one', { now }).tasks;
		expect(rambleNewTask(spoken!, null)).toEqual({
			title: 'Call mom',
			projectId: null,
			sectionId: null,
			labelIds: [],
			due: { date: '2026-10-15', time: '17:00' },
			recurrence: null,
			priority: 1,
			reminders: [],
			location: null,
			event: null,
		});
	});

	test('list defaults fill only what speech left empty', () => {
		const saved = rambleNewTask(task('Pay rent', { projectId: 'spoken', labelIds: ['bills'] }), {
			...NO_DEFAULTS,
			projectId: 'list-project',
			labelId: 'errands',
			date: '2026-10-14',
		});
		expect(saved.projectId).toBe('spoken');
		expect(saved.labelIds).toEqual(['errands', 'bills']);
		expect(saved.due).toEqual({ date: '2026-10-14', time: null });
	});

	test('a spoken date wins over the heading day', () => {
		const saved = rambleNewTask(task('Pay rent', { due: { date: '2026-10-20', time: null } }), {
			...NO_DEFAULTS,
			date: '2026-10-14',
		});
		expect(saved.due).toEqual({ date: '2026-10-20', time: null });
	});

	test('a subtask takes no defaults', () => {
		const saved = rambleNewTask(task('Milk'), null);
		expect(saved).toEqual({
			title: 'Milk',
			projectId: null,
			sectionId: null,
			labelIds: [],
			due: null,
			recurrence: null,
			priority: null,
			reminders: [],
			location: null,
			event: null,
		});
	});

	const rewe: TaskLocation = {
		name: 'Rewe',
		address: null,
		latitude: 52.5,
		longitude: 13.4,
		radius: 150,
		trigger: 'arrive',
	};
	const standup: TaskEvent = {
		id: 'standup',
		title: 'Standup',
		allDay: false,
		series: true,
		edge: 'start',
		minutes: 0,
		occurrences: [{ start: 1791990000000, end: 1791991800000, original: 1791990000000 }],
	};

	test('a section list keeps its section unless the speech names another project', () => {
		const defaults = { ...NO_DEFAULTS, projectId: 'home', sectionId: 'kitchen' };
		expect(rambleNewTask(task('Fix tap'), defaults).sectionId).toBe('kitchen');
		expect(rambleNewTask(task('Fix tap', { projectId: 'home' }), defaults).sectionId).toBe('kitchen');
		const elsewhere = rambleNewTask(task('Fix tap', { projectId: 'work' }), defaults);
		expect([elsewhere.projectId, elsewhere.sectionId]).toEqual(['work', null]);
	});

	test('a place list saves its place', () => {
		expect(rambleNewTask(task('Buy milk'), { ...NO_DEFAULTS, location: rewe }).location).toEqual(rewe);
	});

	test("an event list's event replaces a spoken date and repeat", () => {
		const spoken = task('Share notes', {
			due: { date: '2026-10-20', time: '09:00' },
			recurrence: { interval: 1, unit: 'day' },
		});
		const saved = rambleNewTask(spoken, { ...NO_DEFAULTS, event: standup });
		expect([saved.event, saved.due, saved.recurrence]).toEqual([standup, null, null]);
	});
});
