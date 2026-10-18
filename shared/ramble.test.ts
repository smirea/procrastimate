import { expect } from 'bun:test';
import {
	CORPUS,
	LABELS,
	NO_METADATA_CATEGORIES,
	PRECISION_CATEGORIES,
	PROJECTS,
	SCORED,
	type ExpectedTask,
	type RambleCase,
} from './fixtures/ramble-corpus.ts';
import * as ramble from './ramble.ts';
import type { RambleDraft, RambleTask } from './ramble.ts';
import type { DateKey, TimeOfDay } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const parseRamble = recorded('ramble', ramble.parseRamble);

// Wednesday, October 14 2026, 10:00 local time.
const now = new Date(2026, 9, 14, 10, 0);
const options = { now, projects: PROJECTS, labels: LABELS };

type Shape = Omit<RambleTask, 'segment' | 'subtasks'> & { subtasks: Shape[] };

function shape(task: RambleTask): Shape {
	const { segment: _, subtasks, labelIds, ...rest } = task;
	return { ...rest, labelIds: labelIds.toSorted(), subtasks: subtasks.map(shape) };
}

const idOf = (list: readonly { id: string; name: string }[], name: string) => {
	const found = list.find(item => item.name === name);
	if (!found) throw new Error(`No seed named ${name}`);
	return found.id;
};

function expectedShape(task: ExpectedTask): Shape {
	const [date, time] = task.due?.split(' ') ?? [];
	return {
		title: task.title,
		notes: task.notes ?? '',
		due: date ? { date: date as DateKey, time: (time ?? null) as TimeOfDay | null } : null,
		recurrence: task.recurrence ?? null,
		priority: task.priority ?? null,
		reminders: task.reminders ?? [],
		projectId: task.project ? idOf(PROJECTS, task.project) : null,
		labelIds: (task.labels ?? []).map(name => idOf(LABELS, name)).toSorted(),
		subtasks: (task.subtasks ?? []).map(expectedShape),
	};
}

// ---------------------------------------------------------------------------------------------------
// Provenance: every field on a drafted task traces to a recognized phrase inside that task's own
// segment, not counting its subtasks' segments.

function unprovenanced(draft: RambleDraft): string[] {
	const problems: string[] = [];
	const check = (task: RambleTask, path: string) => {
		const own = draft.tokens.filter(
			token =>
				token.start >= task.segment.start &&
				token.end <= task.segment.end &&
				!task.subtasks.some(s => token.start >= s.segment.start && token.end <= s.segment.end),
		);
		const count = (...kinds: string[]) => own.filter(token => kinds.includes(token.kind)).length;
		if (task.due && !count('due', 'recurrence')) problems.push(`${path}: due`);
		if (task.recurrence && !count('recurrence')) problems.push(`${path}: recurrence`);
		if (task.priority && !count('priority')) problems.push(`${path}: priority`);
		if (task.projectId && !count('project')) problems.push(`${path}: project`);
		if (task.labelIds.length > count('label')) problems.push(`${path}: labels`);
		if (task.reminders.length > count('reminder')) problems.push(`${path}: reminders`);
		task.subtasks.forEach((s, i) => check(s, `${path}.${i}`));
	};
	draft.tasks.forEach((task, i) => check(task, `${i}`));
	return problems;
}

const metadataOf = (task: Shape | RambleTask): number =>
	(task.due ? 1 : 0) +
	(task.recurrence ? 1 : 0) +
	(task.priority ? 1 : 0) +
	(task.projectId ? 1 : 0) +
	task.labelIds.length +
	task.reminders.length +
	task.subtasks.reduce((sum: number, s: Shape | RambleTask) => sum + metadataOf(s), 0);

const normalizeTitle = (title: string) =>
	title
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}\s]/gu, '')
		.replaceAll(/\s+/g, ' ')
		.trim();

function align(expected: Shape[], actual: Shape[]): Array<[Shape, Shape | null]> {
	const free = new Set(actual.map((_, i) => i));
	const pairs: Array<[Shape, number | null]> = expected.map(e => {
		const i = [...free].find(j => normalizeTitle(actual[j]!.title) === normalizeTitle(e.title));
		if (i === undefined) return [e, null];
		free.delete(i);
		return [e, i];
	});
	return pairs.map(([e, i]) => {
		if (i !== null) return [e, actual[i]!];
		const next = [...free].sort((a, b) => a - b)[0];
		if (next === undefined) return [e, null];
		free.delete(next);
		return [e, actual[next]!];
	});
}

function fieldItems(task: Shape | null): Set<string> {
	if (!task) return new Set();
	const items = new Set<string>();
	if (task.due) items.add(`due:${JSON.stringify(task.due)}`);
	if (task.recurrence) items.add(`recurrence:${JSON.stringify(task.recurrence)}`);
	if (task.priority) items.add(`priority:${task.priority}`);
	if (task.projectId) items.add(`project:${task.projectId}`);
	for (const id of task.labelIds) items.add(`label:${id}`);
	for (const reminder of task.reminders) items.add(`reminder:${JSON.stringify(reminder)}`);
	return items;
}

type Tally = { hits: number; total: number };
const tally = (): Tally => ({ hits: 0, total: 0 });
const rate = ({ hits, total }: Tally) => (total ? hits / total : 1);

type Score = {
	invented: number;
	precision: Tally;
	recall: Tally;
	separatorCount: Tally;
	naturalCount: Tally;
	titles: Tally;
	subtasks: Tally;
	passing: Set<string>;
};

function score(results: Array<{ item: RambleCase; draft: RambleDraft }>): Score {
	const s: Score = {
		invented: 0,
		precision: tally(),
		recall: tally(),
		separatorCount: tally(),
		naturalCount: tally(),
		titles: tally(),
		subtasks: tally(),
		passing: new Set(),
	};
	for (const { item, draft } of results) {
		const expected = item.expected.map(expectedShape);
		const actual = draft.tasks.map(shape);
		s.invented += unprovenanced(draft).length;
		if (NO_METADATA_CATEGORIES.includes(item.category))
			s.invented += actual.reduce((n, task) => n + metadataOf(task), 0);
		if (Bun.deepEquals(actual, expected) && draft.ended === (item.ended ?? false)) s.passing.add(item.id);

		const countTally =
			item.category === 'separators' ? s.separatorCount : item.category === 'natural' ? s.naturalCount : null;
		if (countTally) {
			countTally.total++;
			if (actual.length === expected.length) countTally.hits++;
		}

		const statesMetadata = expected.some(task => metadataOf(task) > 0);
		const compare = (pairs: Array<[Shape, Shape | null]>, actualTasks: Shape[]) => {
			// Metadata on a task no expected task pairs with is never right.
			for (const extra of actualTasks.filter(a => !pairs.some(([, b]) => b === a))) {
				s.precision.total += fieldItems(extra).size;
			}
			for (const [e, a] of pairs) {
				s.titles.total++;
				if (a && normalizeTitle(a.title) === normalizeTitle(e.title)) s.titles.hits++;
				const want = fieldItems(e);
				const got = fieldItems(a);
				const hits = [...got].filter(x => want.has(x)).length;
				s.precision.hits += hits;
				s.precision.total += got.size;
				if (statesMetadata) {
					s.recall.hits += hits;
					s.recall.total += want.size;
				}
				compare(align(e.subtasks, a?.subtasks ?? []), a?.subtasks ?? []);
			}
		};
		compare(align(expected, actual), actual);

		if (expected.some(task => task.subtasks.length)) {
			s.subtasks.total++;
			const same =
				expected.length === actual.length &&
				expected.every((task, i) => {
					const other = actual[i]!.subtasks.map(x => normalizeTitle(x.title));
					return Bun.deepEquals(
						task.subtasks.map(x => normalizeTitle(x.title)),
						other,
					);
				});
			if (same) s.subtasks.hits++;
		}
	}
	return s;
}

const percent = (t: Tally) => `${(rate(t) * 100).toFixed(1)}% (${t.hits}/${t.total})`;

test('the corpus is large, unique, and scores only non-precision cases', () => {
	expect(CORPUS.length).toBeGreaterThanOrEqual(300);
	expect(new Set(CORPUS.map(c => c.id)).size).toBe(CORPUS.length);
	for (const id of SCORED) {
		const item = CORPUS.find(c => c.id === id);
		expect(item, `scored id ${id} is in the corpus`).toBeDefined();
		expect(PRECISION_CATEGORIES.includes(item!.category), `${id} is a precision case`).toBe(false);
	}
});

describe('locked cases', () => {
	for (const item of CORPUS.filter(c => !SCORED.has(c.id))) {
		test(item.id, () => {
			const draft = parseRamble(item.transcript, options);
			expect(unprovenanced(draft)).toEqual([]);
			expect(draft.tasks.map(shape)).toEqual(item.expected.map(expectedShape));
			expect(draft.ended).toBe(item.ended ?? false);
		});
	}
});

test('the scorer meets every target', () => {
	const results = CORPUS.map(item => ({ item, draft: ramble.parseRamble(item.transcript, options) }));
	const s = score(results);
	const nowPassing = [...SCORED].filter(id => s.passing.has(id));
	console.log(
		[
			`Ramble corpus: ${CORPUS.length} cases, ${CORPUS.length - SCORED.size} locked, ${SCORED.size} scored`,
			`  Invented fields:                    ${s.invented} (target 0)`,
			`  Metadata precision:                 ${percent(s.precision)} (target 100%)`,
			`  Metadata recall:                    ${percent(s.recall)} (target >= 95%)`,
			`  Task count, explicit separators:    ${percent(s.separatorCount)} (target 100%)`,
			`  Task count, natural rambles:        ${percent(s.naturalCount)} (target >= 90%)`,
			`  Exact titles:                       ${percent(s.titles)} (target >= 90%)`,
			`  Subtask structure:                  ${percent(s.subtasks)} (target >= 95%)`,
			...(nowPassing.length ? [`  Now passing, move to locked: ${nowPassing.join(', ')}`] : []),
		].join('\n'),
	);
	expect(s.invented).toBe(0);
	expect(rate(s.precision)).toBe(1);
	expect(rate(s.recall)).toBeGreaterThanOrEqual(0.95);
	expect(rate(s.separatorCount)).toBe(1);
	expect(rate(s.naturalCount)).toBeGreaterThanOrEqual(0.9);
	expect(rate(s.titles)).toBeGreaterThanOrEqual(0.9);
	expect(rate(s.subtasks)).toBeGreaterThanOrEqual(0.95);
});

describe('draft details', () => {
	test('tokens carry transcript offsets, including normalized phrases', () => {
		const transcript = 'Call mom tomorrow at five p.m. priority one';
		const draft = parseRamble(transcript, options);
		expect(draft.tokens).toEqual([
			{ kind: 'due', start: 9, end: 30, text: 'tomorrow at five p.m.' },
			{ kind: 'priority', start: 31, end: 43, text: 'priority one' },
		]);
		expect(draft.tasks[0]!.segment).toEqual({ start: 0, end: transcript.length });
	});

	test('separators, notes, subtasks, corrections, and the ending are tokens too', () => {
		const draft = parseRamble(
			"Buy paint. Note the blue one. Next task clean garage subtask sort tools. Call Sam scratch that. That's all.",
			options,
		);
		expect(draft.tokens.map(token => [token.kind, token.text])).toEqual([
			['note', 'Note'],
			['separator', 'Next task'],
			['subtask', 'subtask'],
			['correction', 'scratch that.'],
			['end', "That's all."],
		]);
		expect(draft.ended).toBe(true);
	});

	test('a root without a title gives its subtasks up as roots, each token once', () => {
		const draft = parseRamble('Tomorrow at 5pm. Subtask buy milk tomorrow at 6pm.', options);
		expect(draft.tasks.map(task => task.title)).toEqual(['Buy milk']);
		expect(draft.tokens.map(token => [token.kind, token.start, token.end])).toEqual([
			['subtask', 17, 24],
			['due', 34, 49],
		]);
		for (const { transcript } of CORPUS) {
			const tokens = ramble.parseRamble(transcript, options).tokens;
			const spans = tokens.map(token => `${token.kind}:${token.start}-${token.end}`);
			expect(new Set(spans).size).toBe(spans.length);
		}
	});

	test('a character outside the BMP survives at the start of a title', () => {
		const draft = parseRamble('😀 call mom tomorrow', options);
		expect(draft.tasks.map(shape)).toEqual([expectedShape({ title: '😀 call mom', due: '2026-10-15' })]);
	});

	test('a subtask segment lies inside its parent segment', () => {
		const draft = parseRamble('Plan the party with subtasks invitations and cake. Call mom.', options);
		const [party, call] = draft.tasks;
		for (const subtask of party!.subtasks) {
			expect(subtask.segment.start).toBeGreaterThanOrEqual(party!.segment.start);
			expect(subtask.segment.end).toBeLessThanOrEqual(party!.segment.end);
		}
		expect(call!.segment.start).toBeGreaterThan(party!.segment.end);
	});

	test('a partial transcript parses on every update', () => {
		const transcript = 'Buy milk next task call mom tomorrow at 5pm';
		for (let end = 1; end <= transcript.length; end++) {
			const draft = ramble.parseRamble(transcript.slice(0, end), options);
			expect(unprovenanced(draft)).toEqual([]);
		}
	});

	test('a subtask ignores project phrases', () => {
		const draft = parseRamble('Clean garage subtask sort tools in project Home', options);
		expect(draft.tasks[0]!.projectId).toBe(null);
		expect(draft.tasks[0]!.subtasks[0]).toMatchObject({ title: 'Sort tools in project Home', projectId: null });
	});

	test('without projects or labels every phrase stays text', () => {
		const draft = parseRamble('Book flights in project Home label calls', { now });
		expect(draft.tasks.map(shape)).toEqual([expectedShape({ title: 'Book flights in project Home label calls' })]);
	});
});
