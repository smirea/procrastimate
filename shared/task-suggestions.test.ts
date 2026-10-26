import { expect } from 'bun:test';
import * as suggestions from './task-suggestions.ts';
import type { Available, DraftFields } from './task-suggestions.ts';
import type { Task } from './task.ts';
import type { TaskLocation } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';

const suggestionWords = recorded('task-suggestions', function suggestionWords(text: string) {
	return [...suggestions.suggestionWords(text)];
});
// The index holds sets and maps, which a vector cannot, so the vector covers index, vote, and pills in one call.
const pills = recorded(
	'task-suggestions',
	function pills(tasks: readonly Task[], title: string, now: number, draft: DraftFields, available: Available) {
		return suggestions.suggestionPills(
			suggestions.suggestMetadata(suggestions.suggestionIndex(tasks), title, now),
			draft,
			available,
		);
	},
);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 14);
const gym: TaskLocation = {
	name: 'Gym',
	address: '1 Main St',
	latitude: 44.43,
	longitude: 26.1,
	radius: 150,
	trigger: 'arrive',
};

let id = 0;
function task(title: string, fields: Partial<Task> = {}, daysAgo = 10): Task {
	return {
		id: `t${++id}`,
		title,
		notes: '',
		parentId: null,
		order: 0,
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
		createdAt: NOW - daysAgo * DAY,
		completedAt: null,
		createdBy: null,
		completedBy: null,
		lastCompletedAt: null,
		...fields,
	};
}

const empty: DraftFields = { projectId: null, sectionId: null, labelIds: [], location: null };
const everything: Available = {
	projectIds: ['home', 'work'],
	sectionIds: ['garden', 'kitchen', 'meetings'],
	labelIds: ['calls', 'weekend'],
};

const history = [
	task('Water the plants', { projectId: 'home', sectionId: 'garden', labelIds: ['weekend'] }),
	task('Water the lawn', { projectId: 'home', sectionId: 'garden', labelIds: ['weekend'] }),
	task('Mow the lawn', { projectId: 'home', sectionId: 'garden' }),
	task('Call the plumber', { projectId: 'home', sectionId: 'kitchen', labelIds: ['calls'] }),
	task('Call the bank', { projectId: 'work', labelIds: ['calls'] }),
	task('Prepare budget review', { projectId: 'work', sectionId: 'meetings' }),
	task('Leg day', { location: gym }),
	task('Arm day', { location: gym }),
	task('Buy milk'),
];

describe('suggestionWords', () => {
	test('lowercases, drops stop words, and drops a plural s from words over three letters', () => {
		expect(suggestionWords('Water the Plants for Mom, 2 bags')).toEqual(['water', 'plant', 'mom', '2', 'bag']);
	});

	test('keeps letters and digits from any script', () => {
		expect(suggestionWords('Café über-größe 3x')).toEqual(['café', 'über', 'größe', '3x']);
	});
});

describe('suggestionPills', () => {
	test('a title like past ones offers their project, section, and label', () => {
		expect(pills(history, 'water the roses', NOW, empty, everything)).toEqual([
			{ kind: 'project', projectId: 'home' },
			{ kind: 'section', projectId: 'home', sectionId: 'garden' },
			{ kind: 'label', labelId: 'weekend' },
		]);
	});

	test('a tie, or a value under half the vote, offers nothing for that field', () => {
		expect(pills(history, 'call someone', NOW, empty, everything)).toEqual([{ kind: 'label', labelId: 'calls' }]);
		expect(pills(history, 'mow the lawn', NOW, empty, everything)).toEqual([
			{ kind: 'project', projectId: 'home' },
			{ kind: 'section', projectId: 'home', sectionId: 'garden' },
		]);
	});

	test('a place offers the past task’s place', () => {
		expect(pills(history, 'Back day', NOW, empty, everything)).toEqual([{ kind: 'place', location: gym }]);
	});

	test('words no past task shares, or only stop words, offer nothing', () => {
		expect(pills(history, 'Renew passport', NOW, empty, everything)).toEqual([]);
		expect(pills(history, 'the', NOW, empty, everything)).toEqual([]);
		expect(pills([], 'Water the plants', NOW, empty, everything)).toEqual([]);
	});

	test('a recent habit outweighs an older one', () => {
		const changed = [task('Pay rent', { projectId: 'home' }, 400), task('Pay rent', { projectId: 'work' }, 5)];
		expect(pills(changed, 'pay rent', NOW, empty, everything)).toEqual([{ kind: 'project', projectId: 'work' }]);
	});

	test('a field the draft already holds shows no pill', () => {
		const draft: DraftFields = { projectId: 'home', sectionId: null, labelIds: ['weekend'], location: null };
		expect(pills(history, 'water the roses', NOW, draft, everything)).toEqual([
			{ kind: 'section', projectId: 'home', sectionId: 'garden' },
		]);
		expect(pills(history, 'Back day', NOW, { ...empty, location: { ...gym, trigger: 'leave' } }, everything)).toEqual(
			[],
		);
	});

	test('a project, section, or label the draft cannot use shows no pill', () => {
		const only: Available = { projectIds: ['home'], sectionIds: [], labelIds: [] };
		expect(pills(history, 'water the roses', NOW, empty, only)).toEqual([{ kind: 'project', projectId: 'home' }]);
		expect(pills(history, 'water the roses', NOW, empty, { ...only, projectIds: [] })).toEqual([]);
	});
});
