/**
 * `bun scripts/suggestions-eval.ts <view.json> [min-history]` scores quick add's suggestion pills against a snapshot of
 * real data, the agent API's `GET /view`. Each top-level task is suggested from the tasks created before it, so the
 * score is what Stefan would have seen. Precision is right pills over shown pills, recall is right pills over the
 * fields the task really has. `familiar` tasks share at least 0.35 of their rare-word weight with one past title.
 * The baseline offers the most used project and its most used section every time. Prints aggregates only, never
 * titles, so the output can go in a PR.
 */
import type { Task } from '../shared/task.ts';
import type { TaskLocation } from '../shared/values.ts';
import {
	suggestionIndex,
	suggestionWords,
	suggestMetadata,
	type MetadataSuggestions,
	type SuggestionIndex,
} from '../shared/task-suggestions.ts';

const [file, minArg] = process.argv.slice(2);
if (!file) throw new Error('usage: bun scripts/suggestions-eval.ts <view.json> [min-history]');
const minHistory = Number(minArg ?? 30);
const view = (await Bun.file(file).json()) as { tasks: Task[] };
const tasks = view.tasks.filter(t => t.parentId === null).toSorted((a, b) => a.createdAt - b.createdAt);

const placeKey = (l: TaskLocation) => `${l.name}\n${l.address ?? ''}`;
function pills(m: MetadataSuggestions) {
	const set = new Set<string>();
	if (m.projectId) set.add(`project:${m.projectId}`);
	if (m.projectId && m.sectionId) set.add(`section:${m.sectionId}`);
	for (const id of m.labelIds) set.add(`label:${id}`);
	if (m.location) set.add(`place:${placeKey(m.location)}`);
	return set;
}

function bestMatch(index: SuggestionIndex, title: string) {
	const query = suggestionWords(title);
	let norm = 0;
	for (const w of query) norm += (index.idf.get(w) ?? 0) ** 2;
	if (!norm) return 0;
	let best = 0;
	index.words.forEach((words, i) => {
		let shared = 0;
		for (const w of query) if (words.has(w)) shared += index.idf.get(w)! ** 2;
		if (index.norms[i]) best = Math.max(best, shared / (Math.sqrt(norm) * index.norms[i]!));
	});
	return best;
}

function mostUsed(values: (string | null)[]) {
	const counts = new Map<string | null, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

type Score = {
	n: number;
	shown: number;
	right: number;
	expected: number;
	fields: Map<string, [number, number, number]>;
	ms: number[];
};
const scores = new Map<string, Score>();
function score(bucket: string, have: Set<string>, want: Set<string>, ms = 0) {
	const s: Score = scores.get(bucket) ?? { n: 0, shown: 0, right: 0, expected: 0, fields: new Map(), ms: [] };
	scores.set(bucket, s);
	s.n++;
	s.ms.push(ms);
	s.shown += have.size;
	s.expected += want.size;
	const field = (pill: string) => {
		const name = pill.split(':')[0]!;
		const f = s.fields.get(name) ?? [0, 0, 0];
		s.fields.set(name, f);
		return f;
	};
	for (const p of have) {
		field(p)[2]++;
		if (want.has(p)) s.right++;
	}
	for (const p of want) {
		field(p)[1]++;
		if (have.has(p)) field(p)[0]++;
	}
}

for (let i = minHistory; i < tasks.length; i++) {
	const task = tasks[i]!;
	const history = tasks.slice(0, i);
	const index = suggestionIndex(history);
	const want = pills(task);
	const start = performance.now();
	const got = pills(suggestMetadata(index, task.title, task.createdAt));
	const ms = performance.now() - start;
	score('all', got, want, ms);
	score(bestMatch(index, task.title) >= 0.35 ? 'familiar' : 'new', got, want, ms);
	const words = task.title.split(' ');
	const half = words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join(' ');
	score('half typed', pills(suggestMetadata(index, half, task.createdAt)), want);
	const projectId = mostUsed(history.map(t => t.projectId));
	const sectionId = projectId
		? mostUsed(history.filter(t => t.projectId === projectId && t.sectionId).map(t => t.sectionId))
		: null;
	score('baseline', pills({ projectId, sectionId, labelIds: [], location: null }), want);
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
for (const [bucket, s] of scores) {
	const ms = s.ms.toSorted((a, b) => a - b);
	const fields = [...s.fields]
		.map(([name, [right, expected, shown]]) => `${name} ${right}/${expected} of ${shown}`)
		.join('  ');
	console.log(
		`${bucket.padEnd(10)} n=${s.n} precision ${pct(s.right, s.shown)} recall ${pct(s.right, s.expected)}  ${fields}  ` +
			`median ${ms[ms.length >> 1]!.toFixed(2)}ms p90 ${ms[Math.floor(ms.length * 0.9)]!.toFixed(2)}ms`,
	);
}
