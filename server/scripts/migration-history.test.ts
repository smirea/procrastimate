import { describe, expect, test } from 'bun:test';
import { historyProblems, type History } from './migration-history';

const entry = (idx: number, when: number, tag = `000${idx}_m`) => ({ idx, when, tag });
const history = (entries: ReturnType<typeof entry>[], sql: Record<string, string> = {}): History => ({
	entries,
	sql: tag => sql[tag] ?? `-- ${tag}`,
});
const master = history([entry(0, 100), entry(1, 200)]);

describe('a branch migration history', () => {
	test('equal to master, or with new entries appended in order, is fine', () => {
		expect(historyProblems(master, master)).toEqual([]);
		expect(historyProblems(master, history([entry(0, 100), entry(1, 200), entry(2, 300), entry(3, 400)]))).toEqual([]);
	});

	test('missing an entry of master fails', () => {
		expect(historyProblems(master, history([entry(0, 100)]))).toEqual(['0001_m (idx 1, when 200) is missing.']);
	});

	test("replacing master's entry, as two branches that each add 0002 do, fails", () => {
		const other = history([entry(0, 100), entry(1, 200), entry(2, 300, '0002_ours')]);
		const branch = history([entry(0, 100), entry(1, 200), entry(2, 250, '0002_theirs')]);
		expect(historyProblems(other, branch)).toEqual([
			'0002_ours (idx 2, when 300) became 0002_theirs (idx 2, when 250).',
		]);
	});

	test('a changed when or an edited SQL file on an existing entry fails', () => {
		expect(historyProblems(master, history([entry(0, 100), entry(1, 201)]))).toEqual([
			'0001_m (idx 1, when 200) became 0001_m (idx 1, when 201).',
		]);
		expect(historyProblems(master, history(master.entries, { '0000_m': 'DROP TABLE tasks;' }))).toEqual([
			'0000_m.sql was edited.',
		]);
	});

	test('an appended entry out of order or misnumbered fails', () => {
		expect(historyProblems(master, history([entry(0, 100), entry(1, 200), entry(2, 150)]))).toEqual([
			'0002_m (idx 2, when 150) is not later than 0001_m (idx 1, when 200).',
		]);
		expect(historyProblems(master, history([entry(0, 100), entry(1, 200), entry(3, 300)]))).toEqual([
			'0003_m (idx 3, when 300) should have idx 2.',
		]);
	});
});
