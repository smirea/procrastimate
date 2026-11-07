import { expect } from 'bun:test';
import * as details from './task-details.ts';
import type { Task } from './task.ts';
import { label, project, task } from './testing.ts';
import { describe, recorded, test } from './vectors/record.ts';

const parseTitle = recorded('task-details', details.parseTitle);
const titleDraft = recorded('task-details', details.titleDraft);
const titleTokens = recorded('task-details', details.titleTokens);
const commitTitle = recorded('task-details', details.commitTitle);
const setDue = recorded('task-details', details.setDue);

const context: details.TitleContext = {
	now: new Date(2026, 9, 14, 10, 0),
	projects: [project('p-home', { name: 'Home' })],
	sections: [],
	labels: [label('l-calls', { name: 'calls' })],
};
const edit = (base: Task, title: string) => [base, title, parseTitle(title, base, context)] as const;

describe('task details title', () => {
	test('the draft shows what the edited title will apply', () => {
		const base = task('t', { title: 'Water plants', labelIds: ['l-old'], reminders: [{ kind: 'before', minutes: 0 }] });
		const draft = titleDraft(...edit(base, 'Water plants fri 6pm !! remind me 1h before #Home @calls'));
		expect(draft).toMatchObject({
			title: 'Water plants',
			due: { date: '2026-10-16', time: '18:00' },
			priority: 2,
			projectId: 'p-home',
			labelIds: ['l-old', 'l-calls'],
			reminders: [
				{ kind: 'before', minutes: 0 },
				{ kind: 'before', minutes: 60 },
			],
		});
		expect(titleDraft(...edit(base, base.title))).toMatchObject({ title: 'Water plants', labelIds: ['l-old'] });
	});

	test('only an edited title highlights what it will apply', () => {
		const base = task('t', { title: 'Sign out of prime and yt nov 7', due: { date: '2026-10-14', time: '09:00' } });
		expect(titleTokens(...edit(base, base.title))).toEqual([]);
		expect(titleDraft(...edit(base, base.title)).due).toEqual({ date: '2026-10-14', time: '09:00' });
		const edited = edit(base, `${base.title} p1`);
		expect(titleTokens(...edited).map(token => token.text)).toEqual(['nov 7', 'p1']);
		expect(titleDraft(...edited).due).toEqual({ date: '2026-11-07', time: null });
	});

	test('a literal title saves an edit as typed', () => {
		const base = task('t', { title: 'Standup notse 9am tomorrow p1', titleMode: 'literal' });
		const fixed = edit(base, 'Standup notes 9am tomorrow p1  #Home');
		expect(titleTokens(...fixed)).toEqual([]);
		expect(commitTitle(...fixed)).toMatchObject({
			kind: 'update',
			patch: { title: 'Standup notes 9am tomorrow p1 #Home', due: null, priority: 4, projectId: null },
		});
	});

	test('committing saves the draft, or reverts an edit that leaves no title', () => {
		const base = task('t', { title: 'Standup', priority: 3 });
		expect(commitTitle(...edit(base, 'Standup'))).toEqual({ kind: 'unchanged' });
		expect(commitTitle(...edit(base, 'tomorrow'))).toEqual({ kind: 'revert' });
		expect(commitTitle(...edit(base, 'Standup fri'))).toMatchObject({
			kind: 'update',
			patch: { title: 'Standup', due: { date: '2026-10-16', time: null }, priority: 3 },
		});
	});

	test('an event task ignores a typed date and repeat', () => {
		const event = {
			id: 'meetup',
			title: 'Walking meetup',
			allDay: false,
			series: true,
			edge: 'during' as const,
			minutes: 0,
			occurrences: [{ start: 0, end: 1, original: 0 }],
		};
		const base = task('t', { title: 'Talk to Jan', event });
		expect(commitTitle(...edit(base, 'Talk to Jan every fri'))).toMatchObject({
			kind: 'update',
			patch: { title: 'Talk to Jan', due: null, recurrence: null },
		});
	});

	test('a subtask title keeps a project hashtag as text', () => {
		const parsed = parseTitle('Charger #Home', task('s', { parentId: 't', title: 'Charger' }), context);
		expect(parsed.title).toBe('Charger #Home');
		expect(parsed.projectId).toBeNull();
	});

	test('removing the date removes the repeat', () => {
		const base = task('t', { due: { date: '2026-10-14', time: null }, recurrence: { interval: 1, unit: 'day' } });
		expect(setDue(base, null)).toEqual({ due: null, recurrence: null });
		expect(setDue(base, { date: '2026-10-15', time: null })).toEqual({
			due: { date: '2026-10-15', time: null },
			recurrence: { interval: 1, unit: 'day' },
		});
	});
});
