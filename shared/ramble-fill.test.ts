import { describe, expect, test } from 'bun:test';
import { parseRamble } from './ramble.ts';
import { rambleNewTask } from './ramble-fill.ts';
import type { RambleTask } from './ramble.ts';

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
		expect(rambleNewTask(spoken!, null, '2026-10-14')).toEqual({
			title: 'Call mom',
			projectId: null,
			labelIds: [],
			due: { date: '2026-10-15', time: '17:00' },
			recurrence: null,
			priority: 1,
			reminders: [],
		});
	});

	test('list defaults fill only what speech left empty', () => {
		const saved = rambleNewTask(
			task('Pay rent', { projectId: 'spoken', labelIds: ['bills'] }),
			{ projectId: 'list-project', labelId: 'errands', today: true },
			'2026-10-14',
		);
		expect(saved.projectId).toBe('spoken');
		expect(saved.labelIds).toEqual(['errands', 'bills']);
		expect(saved.due).toEqual({ date: '2026-10-14', time: null });
	});

	test('a spoken date wins over Today', () => {
		const saved = rambleNewTask(
			task('Pay rent', { due: { date: '2026-10-20', time: null } }),
			{ projectId: null, labelId: null, today: true },
			'2026-10-14',
		);
		expect(saved.due).toEqual({ date: '2026-10-20', time: null });
	});

	test('a subtask takes no defaults', () => {
		const saved = rambleNewTask(task('Milk'), null, '2026-10-14');
		expect(saved).toEqual({
			title: 'Milk',
			projectId: null,
			labelIds: [],
			due: null,
			recurrence: null,
			priority: null,
			reminders: [],
		});
	});
});
