import { parseArgs } from 'node:util';
import { basename } from 'node:path';
import { parseRamble, resolveOutline, type RambleTask } from '../../shared/ramble';
import type { Label, Project } from '../../shared/task';
import { outlineRamble, type GeminiModel, type GeminiThinking } from '../src/ramble-outline';

/**
 * Scores Ramble's parsers on labelled rambles: the grammar, and Gemini models through the production outline call.
 * The cases are `shared/fixtures/ramble-eval/*.json`. Tune on `dev`, `structure`, and `todoist-dev`; run the holdouts
 * once at the end. A case key that is absent is not scored, so structure-only sets still count.
 *
 *   TZ=UTC bun server/scripts/ramble-eval.ts [-v] [--gap ms] [--out file] --with <strategy,...> <cases.json>...
 *
 * Strategies: `grammar`, or `gemini:<model>[:<thinking>]`. Gemini reads the key from
 * `GEMINI_API_KEY`. `--gap` spaces calls for free-tier rate limits; latency counts only the successful call.
 */

type Expected = {
	title: string;
	subtasks?: Array<string | Expected>;
	date?: string | null;
	time?: string | null;
	remindBefore?: number[];
	priority?: number | null;
	project?: string | null;
	labels?: string[];
	notes?: string | null;
};
type Case = { text: string; tasks: Expected[] };

const projects: Project[] = ['Home', 'Work', 'Side Project', 'Finance'].map(
	(name, i) => ({ id: `p${i}`, name, createdAt: 0 }) as Project,
);
const labels: Label[] = ['calls', 'errands', 'waiting', 'deep work'].map(
	(name, i) => ({ id: `l${i}`, name, createdAt: 0 }) as Label,
);
// Wednesday 2026-10-14 14:00, the instant the labelled cases resolve relative dates against.
const now = new Date(1791986400_000);
if (now.getHours() !== 14) throw new Error('Run with TZ=UTC: the labelled dates assume 14:00 UTC.');

const { values, positionals } = parseArgs({
	options: {
		v: { type: 'boolean', default: false },
		gap: { type: 'string', default: '0' },
		out: { type: 'string' },
		with: { type: 'string', default: 'grammar' },
	},
	allowPositionals: true,
});
const files = positionals;
const strategies = values.with.split(',');
if (!files.length)
	throw new Error('usage: ramble-eval.ts [-v] [--gap ms] [--out file] --with <strategy,...> <cases.json>...');
const gap = Number(values.gap);

type Strategy = (text: string) => Promise<RambleTask[]>;

function strategy(name: string): Strategy {
	if (name === 'grammar') return async text => parseRamble(text, { now, projects, labels }).tasks;
	const [kind, model, thinking] = name.split(':');
	if (kind !== 'gemini' || !model) throw new Error(`unknown strategy ${name}`);
	const key = process.env.GEMINI_API_KEY;
	if (!key) throw new Error('GEMINI_API_KEY is not set');
	const config: GeminiModel = { model, thinking: (thinking as GeminiThinking | undefined) ?? null };
	const input = {
		today: '2026-10-14',
		time: '14:00',
		projects: projects.map(p => p.name),
		labels: labels.map(l => l.name),
	} as const;
	return async text =>
		resolveOutline(await outlineRamble({ ...input, transcript: text }, key, config), { now, projects, labels });
}

const STOP = new Set(['a', 'an', 'the', 'some', 'my', 'our']);
const words = (s: string) =>
	new Set(
		s
			.toLowerCase()
			.split(/[^\p{L}\p{N}']+/u)
			.filter(w => w && !STOP.has(w)),
	);
function same(a: string, b: string, threshold = 0.7): boolean {
	const x = words(a);
	const y = words(b);
	if (!x.size || !y.size) return x.size === y.size;
	const shared = [...x].filter(w => y.has(w)).length;
	return shared / new Set([...x, ...y]).size >= threshold;
}

const asExpected = (e: string | Expected): Expected => (typeof e === 'string' ? { title: e } : e);
const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? null;
const labelNames = (ids: string[]) => ids.map(id => labels.find(l => l.id === id)!.name).toSorted();

function structureMatches(out: readonly RambleTask[], want: readonly Expected[]): boolean {
	return (
		out.length === want.length &&
		out.every((task, i) => {
			const e = want[i]!;
			return same(task.title, e.title) && structureMatches(task.subtasks, (e.subtasks ?? []).map(asExpected));
		})
	);
}

/** Every scored field, by name, that differs. Structure must match first. */
function fieldMisses(out: readonly RambleTask[], want: readonly Expected[]): string[] {
	return out.flatMap((task, i) => {
		const e = want[i]!;
		const misses: string[] = [];
		if (e.date !== undefined && (task.due?.date ?? null) !== e.date) misses.push('date');
		if (e.time !== undefined && (task.due?.time ?? null) !== e.time) misses.push('time');
		if (e.remindBefore !== undefined) {
			const got = task.reminders.flatMap(r => (r.kind === 'before' ? [r.minutes] : [])).toSorted();
			if (JSON.stringify(got) !== JSON.stringify(e.remindBefore.toSorted())) misses.push('reminder');
		}
		if (e.priority !== undefined && task.priority !== e.priority) misses.push('priority');
		if (e.project !== undefined && projectName(task.projectId) !== e.project) misses.push('project');
		if (e.labels !== undefined && JSON.stringify(labelNames(task.labelIds)) !== JSON.stringify(e.labels.toSorted()))
			misses.push('labels');
		if (e.notes !== undefined && !(e.notes ? same(task.notes, e.notes, 0.5) : !task.notes)) misses.push('notes');
		return [...misses, ...fieldMisses(task.subtasks, (e.subtasks ?? []).map(asExpected))];
	});
}

const show = (tasks: readonly RambleTask[], depth = 0): string =>
	tasks
		.map(t => {
			const bits = [
				t.title,
				t.due && `@${t.due.date}${t.due.time ? ` ${t.due.time}` : ''}`,
				t.recurrence && '↻',
				t.priority && `p${t.priority}`,
				t.reminders.length &&
					`⏰${JSON.stringify(t.reminders.map(r => (r.kind === 'before' ? r.minutes : `${r.date} ${r.time}`)))}`,
				projectName(t.projectId) && `#${projectName(t.projectId)}`,
				t.labelIds.length && `@[${labelNames(t.labelIds)}]`,
				t.notes && `📝${t.notes}`,
			].filter(Boolean);
			return `${'  '.repeat(depth)}- ${bits.join(' ')}${t.subtasks.length ? `\n${show(t.subtasks, depth + 1)}` : ''}`;
		})
		.join('\n');
const showWant = (tasks: readonly Expected[], depth = 0): string =>
	tasks
		.map(asExpected)
		.map(e => {
			const bits = [
				e.title,
				e.date && `@${e.date}${e.time ? ` ${e.time}` : ''}`,
				e.priority && `p${e.priority}`,
				e.remindBefore?.length && `⏰${JSON.stringify(e.remindBefore)}`,
				e.project && `#${e.project}`,
				e.labels?.length && `@[${e.labels}]`,
				e.notes && `📝${e.notes}`,
			].filter(Boolean);
			const subs = (e.subtasks ?? []).map(asExpected);
			return `${'  '.repeat(depth)}- ${bits.join(' ')}${subs.length ? `\n${showWant(subs, depth + 1)}` : ''}`;
		})
		.join('\n');

async function withRetry(run: () => Promise<RambleTask[]>): Promise<{ tasks: RambleTask[]; ms: number }> {
	for (let attempt = 0; ; attempt++) {
		const started = performance.now();
		try {
			const tasks = await run();
			return { tasks, ms: performance.now() - started };
		} catch (error) {
			const message = String(error);
			if (attempt < 6 && /\b(429|500|503)\b/.test(message)) {
				await Bun.sleep(Math.min(60_000, 5_000 * 2 ** attempt));
				continue;
			}
			throw error;
		}
	}
}

const percentile = (xs: number[], p: number) => {
	const sorted = xs.toSorted((a, b) => a - b);
	return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! : 0;
};

const rows: Array<Record<string, string | number>> = [];
const report: Array<{
	strategy: string;
	set: string;
	text: string;
	ok: boolean;
	structure: boolean;
	misses: string[];
	ms: number;
	got: string;
	error?: string;
}> = [];

await Promise.all(
	strategies.map(async name => {
		const run = strategy(name);
		for (const file of files) {
			const cases = (await Bun.file(file).json()) as Case[];
			const score = { structure: 0, fields: 0, both: 0, errors: 0, times: [] as number[] };
			const missCounts: Record<string, number> = {};
			for (const c of cases) {
				let out: RambleTask[] = [];
				let error: string | undefined;
				try {
					const result = await withRetry(() => run(c.text));
					out = result.tasks;
					score.times.push(result.ms);
				} catch (e) {
					score.errors++;
					error = String(e).slice(0, 200);
				}
				const structure = structureMatches(out, c.tasks);
				const misses = structure ? fieldMisses(out, c.tasks) : ['structure'];
				for (const miss of misses) missCounts[miss] = (missCounts[miss] ?? 0) + 1;
				if (structure) score.structure++;
				if (structure && !misses.length) score.both++;
				report.push({
					strategy: name,
					set: basename(file),
					text: c.text,
					ok: structure && !misses.length,
					structure,
					misses,
					ms: Math.round(score.times.at(-1) ?? 0),
					got: show(out),
					error,
				});
				if (values.v && !(structure && !misses.length)) {
					console.log(
						`\n[${name}] ${c.text}\n want\n${showWant(c.tasks)}\n got ${misses.join(',')}${error ? ` ERROR ${error}` : ''}\n${show(out)}`,
					);
				}
				if (gap && name !== 'grammar') await Bun.sleep(gap);
			}
			rows.push({
				strategy: name,
				set: basename(file),
				n: cases.length,
				exact: score.both,
				structure: score.structure,
				errors: score.errors,
				p50: Math.round(percentile(score.times, 0.5)),
				p90: Math.round(percentile(score.times, 0.9)),
				misses: Object.entries(missCounts)
					.map(([k, v]) => `${k}:${v}`)
					.join(' '),
			});
		}
	}),
);

console.table(rows.toSorted((a, b) => String(a.set).localeCompare(String(b.set)) || Number(b.exact) - Number(a.exact)));
if (values.out) await Bun.write(values.out, JSON.stringify({ rows, report }, null, 1));
