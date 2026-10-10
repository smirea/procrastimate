import type { Project, Task } from './task.ts';

/** A half-open `[start, end)` span of the original text. */
export type Range = readonly [start: number, end: number];

/** One matched text and the spans to highlight in it. */
export type Highlight = { text: string; ranges: Range[] };

type FieldContext = { projects: ReadonlyMap<string, Project> };

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
	notes: { weight: 1, values: (task: Task) => [task.notes] },
} satisfies Record<string, { weight: number; values: (task: Task, context: FieldContext) => string[] }>;

export type TaskField = keyof typeof TASK_FIELDS;

export type TaskHit = { task: Task; score: number; matches: Partial<Record<TaskField, Highlight[]>> };
export type ProjectHit = { project: Project; score: number; name: Highlight };
export type SearchResults = { projects: ProjectHit[]; open: TaskHit[]; completed: TaskHit[] };

/** `map` points each folded character back to its original offset, and is null when they line up. */
type Folded = { text: string; map: number[] | null };

/** Lowercases and strips accents one character at a time, keeping a map back to the original offsets. */
function fold(text: string): Folded {
	if (/^\p{ASCII}*$/u.test(text)) return { text: text.toLowerCase(), map: null };
	let out = '';
	const map: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const folded = text[i]!.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
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

/** Splits a query into folded terms. Every term must match somewhere for a result to count. */
export function searchTerms(query: string): string[] {
	return fold(query.trim()).text.split(/\s+/).filter(Boolean);
}

/** Scores texts that share a weight: each term counts its best match, and every match is highlighted. */
function scoreTexts(texts: readonly string[], terms: readonly string[]) {
	const folded = texts.map(fold);
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

function scoreTask(task: Task, terms: readonly string[], context: FieldContext): TaskHit | null {
	const values = FIELDS.map(([, spec]) => spec.values(task, context));
	const haystack = fold(values.flat().join('\n')).text;
	if (!terms.every(term => haystack.includes(term))) return null;
	const best = terms.map(() => 0);
	const matches: TaskHit['matches'] = {};
	for (const [i, [field, spec]] of FIELDS.entries()) {
		const scored = scoreTexts(values[i]!, terms);
		scored.best.forEach((quality, i) => (best[i] = Math.max(best[i]!, quality * spec.weight)));
		if (scored.highlights.length) matches[field] = scored.highlights;
	}
	if (best.some(score => score === 0)) return null;
	return { task, score: best.reduce((a, b) => a + b, 0), matches };
}

function scoreProject(project: Project, terms: readonly string[]): ProjectHit | null {
	const { best, highlights } = scoreTexts([project.name], terms);
	if (best.some(quality => quality === 0)) return null;
	return { project, score: best.reduce((a, b) => a + b, 0), name: highlights[0]! };
}

/**
 * Matches tasks and projects against every term of the query, case- and accent-insensitively.
 * A title match outweighs a project match, which outweighs a notes match, and a match at the start of
 * a word outweighs one inside a word. Open tasks break ties by priority, then newest first. Completed
 * tasks come back separately, most recently completed first on a tie.
 */
export function search(query: string, tasks: readonly Task[], projects: readonly Project[]): SearchResults {
	const terms = searchTerms(query);
	if (!terms.length) return { projects: [], open: [], completed: [] };
	const context: FieldContext = { projects: new Map(projects.map(p => [p.id, p])) };
	const hits = tasks.map(task => scoreTask(task, terms, context)).filter(hit => hit !== null);
	return {
		projects: projects
			.map(project => scoreProject(project, terms))
			.filter(hit => hit !== null)
			.toSorted(
				(a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name, undefined, { sensitivity: 'base' }),
			),
		open: hits
			.filter(hit => hit.task.completedAt === null)
			.toSorted(
				(a, b) => b.score - a.score || a.task.priority - b.task.priority || b.task.createdAt - a.task.createdAt,
			),
		completed: hits
			.filter(hit => hit.task.completedAt !== null)
			.toSorted((a, b) => b.score - a.score || b.task.completedAt! - a.task.completedAt!),
	};
}

/** Cuts a long text down to a window that starts a little before its first highlight. */
export function excerpt({ text, ranges }: Highlight, lead = 24): Highlight {
	const first = ranges[0]?.[0] ?? 0;
	if (first <= lead) return { text, ranges };
	const start = text.lastIndexOf(' ', first - lead) + 1 || first - lead;
	return { text: `…${text.slice(start)}`, ranges: ranges.map(([s, e]) => [s - start + 1, e - start + 1] as const) };
}
