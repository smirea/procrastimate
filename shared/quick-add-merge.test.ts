import { expect } from 'bun:test';
import * as merge from './quick-add-merge.ts';
import { describe, recorded, test } from './vectors/record.ts';

const typedOver = recorded('quick-add-merge', merge.typedOver);

const base: merge.Placed = {
	due: { date: '2026-10-14', time: null },
	recurrence: { interval: 1, unit: 'week' },
	priority: 3,
	projectId: 'home',
	sectionId: 'garden',
};
const event = {
	id: 'meetup',
	title: 'Walking meetup',
	allDay: false,
	series: false,
	edge: 'during' as const,
	minutes: 0,
	occurrences: [{ start: 0, end: 1, original: 0 }],
};

describe('typedOver', () => {
	test('nothing typed keeps the base', () => {
		expect(typedOver(base, {}, null)).toEqual(base);
	});

	test('typed values win, and a typed project leaves the base section behind', () => {
		expect(
			typedOver(base, { due: { date: '2026-10-16', time: '18:00' }, priority: 1, projectId: 'work' }, null),
		).toEqual({
			due: { date: '2026-10-16', time: '18:00' },
			recurrence: { interval: 1, unit: 'week' },
			priority: 1,
			projectId: 'work',
			sectionId: null,
		});
	});

	test('typing the base project keeps its section, and a typed section wins', () => {
		expect(typedOver(base, { projectId: 'home' }, null).sectionId).toBe('garden');
		expect(typedOver(base, { projectId: 'work', sectionId: 'inbox' }, null).sectionId).toBe('inbox');
	});

	test('an event stands in for the date and the repeat', () => {
		expect(typedOver(base, { due: { date: '2026-10-16', time: null } }, event)).toEqual({
			...base,
			due: null,
			recurrence: null,
		});
	});

	test('a ramble may have no priority', () => {
		expect(typedOver({ ...base, priority: null }, {}, null).priority).toBeNull();
	});
});
