import { describe, expect, test } from 'bun:test';
import type { RambleTask } from 'shared/ramble.ts';
import { joinTranscript, reconcileCards, taskCountLabel, transcriptPieces, type RambleCard } from './cards.ts';

const today = '2026-10-14';
const defaults = { projectId: null, labelId: null, today: false };
let n = 0;
const id = () => `c${++n}`;

function task(title: string, start: number, extra: Partial<RambleTask> = {}): RambleTask {
	return {
		segment: { start, end: start + title.length },
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

describe('reconcileCards', () => {
	test('keeps a pinned edit and drops a hidden span', () => {
		n = 0;
		const first = reconcileCards([], [task('Buy milk', 0), task('Call mom', 10)], new Set(), defaults, today, id);
		const pinned: RambleCard = { ...first[0]!, title: 'Buy oat milk', pinned: true };
		const next = reconcileCards([pinned, first[1]!], [task('Buy milk', 0), task('Call mom', 10)], new Set([10]), defaults, today, id);
		expect(next.map(card => card.title)).toEqual(['Buy oat milk']);
		expect(next[0]!.id).toBe(pinned.id);
	});

	test('fills the list defaults only where speech left a field empty', () => {
		n = 0;
		const [card] = reconcileCards(
			[],
			[task('Pay rent', 0, { projectId: 'spoken' })],
			new Set(),
			{ projectId: 'inbox-project', labelId: 'errands', today: true },
			today,
			id,
		);
		expect(card!.projectId).toBe('spoken');
		expect(card!.labelIds).toEqual(['errands']);
		expect(card!.due).toEqual({ date: today, time: null });
	});
});

describe('transcript', () => {
	test('tints a token and joins a partial after the committed text', () => {
		expect(transcriptPieces('Pay rent tomorrow', [{ kind: 'due', start: 9, end: 17, text: 'tomorrow' }])).toEqual([
			{ text: 'Pay rent ', kind: null },
			{ text: 'tomorrow', kind: 'due' },
		]);
		expect(joinTranscript('Buy milk', 'tomorrow')).toEqual({ text: 'Buy milk tomorrow', partialStart: 9 });
	});

	test('counts tasks for the add button', () => {
		expect(taskCountLabel(1, 'Add')).toBe('Add 1 task');
		expect(taskCountLabel(3, 'Added')).toBe('Added 3 tasks');
	});
});
