import { describe, expect, test } from 'bun:test';
import type { FeedbackProject } from 'shared/api/contract.ts';
import { FEEDBACK_DRAFT, parseDraftMessage, pickFeedbackProjects, startingFeedbackProject } from './feedback-popup.ts';

const stefan = { id: 'u-stefan', name: 'Stefan', kind: 'human' as const, ownerId: null };
const alice = { id: 'u-alice', name: 'Alice', kind: 'human' as const, ownerId: null };

const project = (id: string, name: string, owner: FeedbackProject['owner'] = null): FeedbackProject => ({
	id,
	name,
	icon: null,
	owner,
	sections: [],
});

const all = [
	project('p-own-1', 'Groceries'),
	project('p-own-2', 'Pandemic'),
	project('p-shared-1', 'Pandemic', stefan),
	project('p-shared-2', 'Website', stefan),
];

describe('feedback popup protocol and project selection', () => {
	test('accepts only well-formed draft messages carrying the popup nonce', () => {
		const full = new Blob(['full'], { type: 'image/jpeg' });
		const thumb = new Blob(['thumb'], { type: 'image/jpeg' });
		const valid = {
			type: FEEDBACK_DRAFT,
			nonce: 'n-1',
			title: 'Board Feedback: 1 change',
			app: 'Pandemic Legacy S2',
			project: 'Pandemic',
			projects: ['Pandemic', 'Website'],
			image: { full, thumb, width: 800, height: 600 },
			report: '{"items":[]}',
		};
		expect(parseDraftMessage(valid, 'n-1')?.title).toBe('Board Feedback: 1 change');
		expect(parseDraftMessage(valid, 'wrong-nonce')).toBeNull();
		expect(
			parseDraftMessage({ ...valid, image: { full: 'not-a-blob', thumb, width: 800, height: 600 } }, 'n-1'),
		).toBeNull();
		expect(parseDraftMessage({ ...valid, projects: [] }, 'n-1')).toBeNull();
		expect(parseDraftMessage({ ...valid, projects: undefined }, 'n-1')).toBeNull();
		const save = new File(['{}'], 'save.json', { type: 'application/json' });
		expect(parseDraftMessage({ ...valid, files: [save] }, 'n-1')?.files).toEqual([save]);
		expect(parseDraftMessage(valid, 'n-1')?.files).toEqual([]);
		expect(parseDraftMessage({ ...valid, files: ['save.json'] }, 'n-1')).toBeNull();
	});

	test('a draft keeps a well-formed title suggestion and still posts without a malformed one', () => {
		const image = { full: new Blob(['f']), thumb: new Blob(['t']), width: 1, height: 1 };
		const base = {
			type: FEEDBACK_DRAFT,
			nonce: 'n-1',
			title: 'Board Feedback: 1 change',
			projects: ['P'],
			image,
			report: '{}',
		};
		const titleSuggestion = { subject: 'Board Feedback', count: 1, prompt: '- On Button "Info": Bigger' };
		expect(parseDraftMessage({ ...base, titleSuggestion }, 'n-1')?.titleSuggestion).toEqual(titleSuggestion);
		const malformed = parseDraftMessage({ ...base, titleSuggestion: { ...titleSuggestion, count: 0 } }, 'n-1');
		expect(malformed?.title).toBe('Board Feedback: 1 change');
		expect(malformed?.titleSuggestion).toBeUndefined();
	});

	test('whitelists projects in order across own and shared spaces and scopes to space when given', () => {
		const scoped = pickFeedbackProjects(all, alice.id, {
			space: stefan.id,
			projects: ['website', 'Pandemic', 'Missing'],
		});
		expect(scoped.projects.map(p => p.id)).toEqual(['p-shared-2', 'p-shared-1']);
		expect(scoped.missing).toEqual(['Missing']);

		// Without `space`, an own project wins on name collision over a shared project.
		const unScoped = pickFeedbackProjects(all, alice.id, { projects: ['Pandemic', 'p-shared-1'] });
		expect(unScoped.projects.map(p => p.id)).toEqual(['p-own-2', 'p-shared-1']);
	});

	test('picks named project first, then last project, then first listed project', () => {
		const listed = [all[2]!, all[3]!];
		expect(startingFeedbackProject(listed, { project: 'website' }, 'p-shared-1')).toBe('p-shared-2');
		expect(startingFeedbackProject(listed, {}, 'p-shared-2')).toBe('p-shared-2');
		expect(startingFeedbackProject(listed, {}, 'p-other')).toBe('p-shared-1');
		expect(startingFeedbackProject([], {}, undefined)).toBeUndefined();
	});
});
