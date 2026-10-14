import { describe, expect, test } from 'bun:test';
import { parseRamble } from './ramble.ts';
import { quickAddFromRamble, withListDefaults, type RambleQuickAdd } from './ramble-fill.ts';
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

describe('quickAddFromRamble', () => {
	test('one task keeps its title and the metadata the grammar found', () => {
		const fill = quickAddFromRamble({
			tasks: [task('Call mom', { due: { date: '2026-10-15', time: '17:00' }, priority: 1, projectId: 'p-home' })],
			tokens: [],
			ended: false,
		});
		expect(fill).toEqual({
			text: 'Call mom',
			due: { date: '2026-10-15', time: '17:00' },
			recurrence: null,
			priority: 1,
			reminders: [],
			projectId: 'p-home',
			labelIds: [],
		} satisfies RambleQuickAdd);
	});

	test('several tasks become one title and do not pick a date', () => {
		const fill = quickAddFromRamble({
			tasks: [task('Buy milk'), task('Call the plumber', { due: { date: '2026-10-15', time: null } })],
			tokens: [],
			ended: false,
		});
		expect(fill?.text).toBe('Buy milk. Call the plumber');
		expect(fill?.due).toBeNull();
	});

	test('a parsed sentence overrides the transcript with the title and its chips', () => {
		const draft = parseRamble('Call mom tomorrow at five p.m. priority one', { now });
		const fill = quickAddFromRamble(draft);
		expect(fill?.text).toBe('Call mom');
		expect(fill?.priority).toBe(1);
		expect(fill?.due?.time).toBe('17:00');
	});
});

describe('withListDefaults', () => {
	test('fills only what speech left empty', () => {
		const fill = withListDefaults(
			{
				text: 'Pay rent',
				due: null,
				recurrence: null,
				priority: null,
				reminders: [],
				projectId: 'spoken',
				labelIds: [],
			},
			{ projectId: 'inbox-project', labelId: 'errands', today: true },
			'2026-10-14',
		);
		expect(fill.projectId).toBe('spoken');
		expect(fill.labelIds).toEqual(['errands']);
		expect(fill.due).toEqual({ date: '2026-10-14', time: null });
	});
});
