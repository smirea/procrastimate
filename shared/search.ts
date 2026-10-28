import { z } from 'zod';
import { labelSchema, projectSchema, taskSchema } from './model.ts';
import type { Label, Project, Task } from './task.ts';
import { openTasks } from './triggers.ts';

/** A half-open `[start, end)` span of the original text. */
export type Range = readonly [start: number, end: number];
export const rangeSchema = z.tuple([z.number().int(), z.number().int()]).readonly();

export const highlightSchema = z
	// Swift's `Range<Int>` encodes as the same two-number array.
	.object({ text: z.string(), ranges: z.array(rangeSchema).meta({ 'x-swift-type': '[Range<Int>]' }) })
	.meta({ id: 'Highlight', description: 'One matched text and the half-open spans to highlight in it.' });
export type Highlight = z.infer<typeof highlightSchema>;

type FieldContext = {
	projects: ReadonlyMap<string, Project>;
	labels: ReadonlyMap<string, Label>;
	/** Each project and label name folded once per search, since a task does not own them. */
	folded: ReadonlyMap<string, Folded>;
};

/**
 * Every searchable text on a task, with how much a match in it counts. A field returns a list so that
 * multi-valued fields, such as labels, fit the same shape.
 */
const TASK_FIELDS = {
	title: { weight: 4, values: (task: Task) => [task.title] },
	project: {
		weight: 2,
		values: (task: Task, { projects }: FieldContext) => {
			const project = task.projectId ? projects.get(task.projectId) : undefined;
			return project ? [project.name] : [];
		},
	},
	labels: {
		weight: 2,
		values: (task: Task, { labels }: FieldContext) => task.labelIds.flatMap(id => labels.get(id)?.name ?? []),
	},
	notes: { weight: 1, values: (task: Task) => [task.notes] },
} satisfies Record<TaskField, { weight: number; values: (task: Task, context: FieldContext) => string[] }>;

export const taskFieldSchema = z
	.enum(['title', 'project', 'labels', 'notes'])
	.meta({ id: 'TaskField', description: 'Every searchable text on a task, in the order fields are scored.' });
export type TaskField = z.infer<typeof taskFieldSchema>;

export const taskHitSchema = z
	.object({
		task: taskSchema,
		score: z.number().int(),
		// Swift keys the matches by the field enum, which encodes as the same object.
		matches: z
			.partialRecord(taskFieldSchema, z.array(highlightSchema))
			.meta({ 'x-swift-type': '[TaskField: [Highlight]]' }),
	})
	.meta({ id: 'TaskHit' });
export type TaskHit = z.infer<typeof taskHitSchema>;
export type NameHit<T extends { name: string }> = { item: T; score: number; name: Highlight };
const nameHitSchema = <T extends z.ZodType<{ name: string }>>(item: T) =>
	z.object({ item, score: z.number().int(), name: highlightSchema });

export const searchResultsSchema = z
	.object({
		// Swift keeps one generic `NameHit`, which JSON Schema cannot name.
		projects: z.array(nameHitSchema(projectSchema)).meta({ 'x-swift-type': '[Search.NameHit<Project>]' }),
		labels: z.array(nameHitSchema(labelSchema)).meta({ 'x-swift-type': '[Search.NameHit<Label>]' }),
		open: z.array(taskHitSchema),
		completed: z.array(taskHitSchema),
	})
	.meta({ id: 'SearchResults' });
export type SearchResults = z.infer<typeof searchResultsSchema>;

type Folded = { text: string; map: number[] | null };

function fold(text: string): Folded {
	if (/^\p{ASCII}*$/u.test(text)) return { text: text.toLowerCase(), map: null };
	let out = '';
	const map: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		const folded = ch.charCodeAt(0) < 128 ? ch.toLowerCase() : ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
		out += folded;
		for (let j = 0; j < folded.length; j++) map.push(i);
	}
	return { text: out, map };
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** 3 at the start of the text, 2 at the start of a word, 1 inside a word. */
type Quality = 0 | 1 | 2 | 3;

/**
 * How well one term matches one text, and every occurrence to highlight. A one-character term only
 * matches at the start of a word, so typing a single letter does not light up every task.
 */
function matchTerm(value: Folded, term: string): { quality: Quality; ranges: Range[] } {
	let quality: Quality = 0;
	const ranges: Range[] = [];
	for (let at = value.text.indexOf(term); at !== -1; at = value.text.indexOf(term, at + term.length)) {
		const q: Quality = at === 0 ? 3 : isWordChar(value.text[at - 1]) ? 1 : 2;
		if (q === 1 && term.length === 1) continue;
		quality = Math.max(quality, q) as Quality;
		const end = at + term.length;
		ranges.push(value.map ? [value.map[at]!, value.map[end - 1]! + 1] : [at, end]);
	}
	return { quality, ranges };
}

function mergeRanges(ranges: Range[]): Range[] {
	const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
	const out: [number, number][] = [];
	for (const [start, end] of sorted) {
		const last = out.at(-1);
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else out.push([start, end]);
	}
	return out;
}

/** Every term must match somewhere for a result to count. */
export function searchTerms(query: string): string[] {
	return fold(query.trim()).text.split(/\s+/).filter(Boolean);
}

function scoreTexts(texts: readonly string[], terms: readonly string[], folded = texts.map(fold)) {
	const ranges = texts.map((): Range[] => []);
	const best = terms.map(term => {
		let quality = 0;
		folded.forEach((value, i) => {
			const match = matchTerm(value, term);
			quality = Math.max(quality, match.quality);
			ranges[i]!.push(...match.ranges);
		});
		return quality;
	});
	const highlights = texts.flatMap((text, i) => (ranges[i]!.length ? [{ text, ranges: mergeRanges(ranges[i]!) }] : []));
	return { best, highlights };
}

const FIELDS = Object.entries(TASK_FIELDS) as [TaskField, (typeof TASK_FIELDS)[TaskField]][];

/** A task's own texts, folded once per task row: a row is replaced, never mutated, so the cache follows it. */
const ownFolds = new WeakMap<Task, { title: Folded[]; notes: Folded[] }>();

function foldedField(task: Task, field: TaskField, texts: readonly string[], context: FieldContext): Folded[] {
	if (field === 'title' || field === 'notes') {
		let own = ownFolds.get(task);
		if (!own) {
			own = { title: [fold(task.title)], notes: [fold(task.notes)] };
			ownFolds.set(task, own);
		}
		return own[field];
	}
	return texts.map(text => context.folded.get(text) ?? fold(text));
}

function scoreTask(task: Task, terms: readonly string[], context: FieldContext): TaskHit | null {
	const values = FIELDS.map(([, spec]) => spec.values(task, context));
	const folded = FIELDS.map(([field], i) => foldedField(task, field, values[i]!, context));
	if (!terms.every(term => folded.some(texts => texts.some(value => value.text.includes(term))))) return null;
	const best = terms.map(() => 0);
	const matches: TaskHit['matches'] = {};
	for (const [i, [field, spec]] of FIELDS.entries()) {
		const scored = scoreTexts(values[i]!, terms, folded[i]!);
		scored.best.forEach((quality, i) => (best[i] = Math.max(best[i]!, quality * spec.weight)));
		if (scored.highlights.length) matches[field] = scored.highlights;
	}
	if (best.some(score => score === 0)) return null;
	return { task, score: best.reduce((a, b) => a + b, 0), matches };
}

function searchNames<T extends { name: string }>(items: readonly T[], terms: readonly string[]): NameHit<T>[] {
	return items
		.flatMap(item => {
			const { best, highlights } = scoreTexts([item.name], terms);
			if (best.some(quality => quality === 0)) return [];
			return [{ item, score: best.reduce((a, b) => a + b, 0), name: highlights[0]! }];
		})
		.toSorted((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'en-US', { sensitivity: 'base' }));
}

export function search(
	query: string,
	tasks: readonly Task[],
	{ projects, labels }: { projects: readonly Project[]; labels: readonly Label[] },
): SearchResults {
	const terms = searchTerms(query);
	if (!terms.length) return { projects: [], labels: [], open: [], completed: [] };
	const context: FieldContext = {
		projects: new Map(projects.map(p => [p.id, p])),
		labels: new Map(labels.map(l => [l.id, l])),
		folded: new Map([...projects, ...labels].map(item => [item.name, fold(item.name)])),
	};
	const hits = tasks.map(task => scoreTask(task, terms, context)).filter(hit => hit !== null);
	const open = new Set(openTasks(tasks));
	return {
		projects: searchNames(projects, terms),
		labels: searchNames(labels, terms),
		open: hits
			.filter(hit => open.has(hit.task))
			.toSorted(
				(a, b) => b.score - a.score || a.task.priority - b.task.priority || b.task.createdAt - a.task.createdAt,
			),
		completed: hits
			.filter(hit => !open.has(hit.task))
			.toSorted((a, b) => b.score - a.score || (b.task.completedAt ?? 0) - (a.task.completedAt ?? 0)),
	};
}

export function excerpt({ text, ranges }: Highlight, lead = 24): Highlight {
	const first = ranges[0]?.[0] ?? 0;
	if (first <= lead) return { text, ranges };
	const start = text.lastIndexOf(' ', first - lead) + 1 || first - lead;
	return { text: `…${text.slice(start)}`, ranges: ranges.map(([s, e]) => [s - start + 1, e - start + 1] as const) };
}
