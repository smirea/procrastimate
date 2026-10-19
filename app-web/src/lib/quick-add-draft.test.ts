import { describe, expect, test } from 'bun:test';
import { parseQuickAdd } from 'shared/quick-add.ts';
import type { Label } from 'shared/task.ts';
import {
	cutTokens,
	draftTask,
	initialPicked,
	labelPick,
	merged,
	shownLabelIds,
	type Picked,
} from './quick-add-draft.ts';

const now = new Date('2026-10-14T10:00:00Z');
const labels: Label[] = [
	{ id: 'calls', name: 'Calls', color: 'gray', place: null, createdAt: 1 },
	{
		id: 'gym',
		name: 'Gym',
		color: 'gray',
		place: { address: null, latitude: 52.5, longitude: 13.4, radius: 200 },
		createdAt: 2,
	},
	{
		id: 'pool',
		name: 'Pool',
		color: 'gray',
		place: { address: null, latitude: 52.6, longitude: 13.5, radius: 100 },
		createdAt: 3,
	},
];
const defaults = { projectId: 'home', sectionId: 'next', labelId: null, location: null, event: null, date: null };
const parse = (text: string, picked = initialPicked(defaults)) =>
	parseQuickAdd(text, {
		now,
		projects: [{ id: 'home', name: 'Home', order: 0, createdAt: 1 }],
		labels,
		projectId: picked.projectId,
		due: picked.due,
	});

describe('quick add draft', () => {
	test('typed values win over picked ones, and a typed project leaves the picked section behind', () => {
		const picked: Picked = { ...initialPicked(defaults), priority: 2, due: { date: '2026-10-20', time: null } };
		const parsed = parse('Call mom tomorrow p1 #Home', picked);
		expect(merged(parsed, picked)).toEqual({
			due: { date: '2026-10-15', time: null },
			recurrence: null,
			priority: 1,
			projectId: 'home',
			sectionId: 'next',
		});
		expect(merged(parse('Call mom', picked), picked).priority).toBe(2);
	});

	test('cutting a token leaves one space between its neighbours', () => {
		const parsed = parse('Call mom tomorrow p1 @calls');
		expect(
			cutTokens(
				'Call mom tomorrow p1 @calls',
				parsed.tokens.filter(t => t.kind === 'due'),
			),
		).toBe('Call mom p1 @calls');
	});

	test('the picker shows picked and typed labels, and the typed place replaces a picked one', () => {
		const picked = { ...initialPicked(defaults), labelIds: ['pool', 'calls'] };
		expect(shownLabelIds(parse('Stretch @gym', picked), picked, labels)).toEqual(['calls', 'gym']);
	});

	test('unchecking a typed label cuts its phrase, and a label the text still types stays the text’s', () => {
		const picked = initialPicked(defaults);
		const parsed = parse('Ping @calls @gym', picked);
		const pick = labelPick([], parsed, picked, labels);
		expect(pick.cut.map(t => t.text)).toEqual(['@calls', '@gym']);
		expect(pick.labelIds).toEqual([]);
		const kept = labelPick(['calls', 'pool'], parsed, picked, labels);
		expect(kept.cut.map(t => t.text)).toEqual(['@gym']);
		expect(kept.labelIds).toEqual(['pool']);
	});

	test('the task takes the typed fields, the picked reminders, and the place, and an event stands in for the date', () => {
		const picked = { ...initialPicked(defaults), reminders: [{ kind: 'before' as const, minutes: 30 }] };
		const task = draftTask(parse('Swim tomorrow 5pm @pool', picked), picked, labels);
		expect(task).toMatchObject({
			title: 'Swim',
			due: { date: '2026-10-15', time: '17:00' },
			projectId: 'home',
			sectionId: 'next',
			labelIds: [],
			location: { name: 'Pool', trigger: 'arrive' },
		});
		expect(task?.reminders).toHaveLength(1);
		const event = {
			id: 'e',
			title: 'Swim meet',
			allDay: false,
			series: false,
			edge: 'start' as const,
			minutes: 0,
			occurrences: [],
		};
		expect(draftTask(parse('Swim tomorrow', picked), { ...picked, event }, labels)).toMatchObject({ due: null, event });
		expect(draftTask(parse('', picked), picked, labels)).toBeNull();
	});
});
