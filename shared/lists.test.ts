import { expect } from 'bun:test';
import * as lists from './lists.ts';
import type { Person } from './sharing.ts';
import { describe, recorded, test } from './vectors/record.ts';
import { label, project, task } from './testing.ts';

const listCatalog = recorded('lists', lists.listCatalog);

// Wednesday, October 14 2026.
const today = '2026-10-14';

const ann: Person = { id: 'ann', name: 'Ann', kind: 'human', ownerId: null };
const park = {
	name: 'Park',
	address: null,
	latitude: 52.52,
	longitude: 13.405,
	radius: 150,
	trigger: 'arrive' as const,
};
const standup = {
	id: 'standup',
	title: 'Standup',
	allDay: false,
	series: false,
	edge: 'before' as const,
	minutes: 15,
	occurrences: [{ start: 1792000000000, end: 1792001800000, original: 1792000000000 }],
};

const summary = (groups: lists.ListGroup[]) =>
	groups.map(g => [
		g.title,
		g.entries.map(e => `${e.kind}:${e.id} ${e.name} ${e.count}${e.owner ? ` by ${e.owner.name}` : ''}`),
	]);

describe('listCatalog', () => {
	test('lists every list in one order, with each count its screen lists', () => {
		const own = {
			tasks: [
				task('overdue', { due: { date: '2026-10-12', time: null } }),
				task('today', { due: { date: today, time: null }, projectId: 'work', labelIds: ['calls'] }),
				task('tomorrow', { due: { date: '2026-10-15', time: null } }),
				task('sunday', { due: { date: '2026-10-18', time: null } }),
				task('next week', { due: { date: '2026-10-20', time: null } }),
				task('undated'),
				task('at the park', { location: park, projectId: 'home' }),
				task('at standup', { event: standup, projectId: 'work' }),
				task('done', { completedAt: 5 }),
			],
			projects: [project('work', { name: 'Work', order: 2 }), project('home', { name: 'Home', order: 1 })],
			labels: [label('calls', { name: 'calls' }), label('errands', { name: 'Errands' })],
		};
		const shared = [
			{
				owner: ann,
				data: {
					tasks: [task('loose', { title: 'Loose' })],
					projects: [project('garden', { name: 'Garden' })],
					labels: [label('weekend', { name: 'Weekend' })],
				},
			},
		];
		expect(summary(listCatalog({ own, shared }, today))).toEqual([
			[
				'Lists',
				[
					'inbox:inbox Inbox 3',
					'tomorrow:tomorrow Tomorrow 1',
					'this-week:this-week This week 5',
					'no-date:no-date No date 1',
				],
			],
			['Projects', ['project:home Home 1', 'project:work Work 2']],
			['Shared with me', ['project:garden Garden 0 by Ann', 'label:weekend Weekend 0 by Ann']],
			['Places', ['place:52.5200,13.4050 Park 1']],
			['Events', ['event:standup Standup 1']],
			['Labels', ['label:calls calls 1', 'label:errands Errands 0']],
		]);
	});

	test('keeps every fixed list and every group when there is nothing to list', () => {
		expect(summary(listCatalog({ own: { tasks: [], projects: [], labels: [] }, shared: [] }, today))).toEqual([
			[
				'Lists',
				[
					'inbox:inbox Inbox 0',
					'tomorrow:tomorrow Tomorrow 0',
					'this-week:this-week This week 0',
					'no-date:no-date No date 0',
				],
			],
			['Projects', []],
			['Shared with me', []],
			['Places', []],
			['Events', []],
			['Labels', []],
		]);
	});
});
