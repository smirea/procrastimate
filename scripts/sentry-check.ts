/**
 * Proves the Sentry smoke path end to end: reads back the latest `Sentry smoke test: <runtime>` events and checks
 * each one names its user, sits in a trace that another project also reported into, and has readable in-app frames.
 *
 * bun scripts/sentry-check.ts [--environment development] [--since 30m] [--expect web,worker,account,ios]
 *
 * Trigger the events first: `/inbox?sentry-smoke` on the web, `PROCRASTIMATE_SENTRY_SMOKE=1` on iOS. Exits non-zero
 * when an expected event is missing or fails a check. Needs `SENTRY_AUTH_TOKEN` (env-manager `scripts` target).
 */
import { parseArgs } from 'node:util';
import env from './env.ts';

const ORG = 'self-uo7';
const API = `https://sentry.io/api/0/organizations/${ORG}`;

const PROJECTS = {
	'procrastimate-web': '4512271645409280',
	'procrastimate-worker': '4512271645474816',
	'procrastimate-ios': '4512271645605888',
} as const;
type Project = keyof typeof PROJECTS;

/** Each smoke trigger, by the name in its error message, and the project it reports to. */
const SMOKES = {
	web: { title: 'Sentry smoke test: web', project: 'procrastimate-web' },
	worker: { title: 'Sentry smoke test: Worker', project: 'procrastimate-worker' },
	account: { title: 'Sentry smoke test: Account', project: 'procrastimate-worker' },
	ios: { title: 'Sentry smoke test: iOS', project: 'procrastimate-ios' },
} as const satisfies Record<string, { title: string; project: Project }>;
type Smoke = keyof typeof SMOKES;

const { values: args } = parseArgs({
	options: {
		environment: { type: 'string', default: 'development' },
		since: { type: 'string', default: '30m' },
		expect: { type: 'string', default: 'web,worker,account' },
	},
});
const expected = args.expect.split(',').map(name => {
	if (!(name in SMOKES)) throw new Error(`--expect takes ${Object.keys(SMOKES).join(', ')}, not "${name}"`);
	return name as Smoke;
});
const token = env.SENTRY_AUTH_TOKEN;
if (!token) throw new Error('SENTRY_AUTH_TOKEN is not set. It lives in env-manager under the scripts target.');

async function get<T>(path: string, query: Record<string, string | string[]> = {}): Promise<T> {
	const url = new URL(`${API}${path}`);
	for (const [key, value] of Object.entries(query)) {
		for (const item of [value].flat()) url.searchParams.append(key, item);
	}
	const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!response.ok)
		throw new Error(`GET ${url.pathname}${url.search} answered ${response.status}: ${await response.text()}`);
	return (await response.json()) as T;
}

type Issue = { id: string; title: string; lastSeen: string; project: { slug: string } };
type Frame = {
	filename: string | null;
	absPath: string | null;
	function: string | null;
	lineNo: number | null;
	inApp: boolean;
};
type Entry =
	| { type: 'exception'; data: { values: { stacktrace: { frames: Frame[] } | null }[] } }
	| { type: 'request'; data: { headers: [string, string][] | null; data: unknown } }
	| { type: string; data: unknown };
type Event = {
	eventID: string;
	dateCreated: string;
	tags: { key: string; value: string }[];
	user: { id?: string; email?: string } | null;
	contexts: { trace?: { trace_id?: string } };
	entries: Entry[];
};

const tag = (event: Event, key: string) => event.tags.find(item => item.key === key)?.value ?? null;

async function latestEvent(smoke: Smoke): Promise<Event | null> {
	const { title, project } = SMOKES[smoke];
	const issues = await get<Issue[]>('/issues/', {
		query: `"${title}"`,
		environment: args.environment,
		statsPeriod: args.since,
		project: PROJECTS[project],
		sort: 'date',
	});
	const issue = issues.find(item => item.title.endsWith(title));
	return issue ? get<Event>(`/issues/${issue.id}/events/latest/`, { environment: args.environment }) : null;
}

/** What else reported into the trace: other projects' errors and transactions. */
async function traceNeighbors(traceId: string): Promise<string[]> {
	const found = new Set<string>();
	const errors = await get<{ data: { project: string; title: string }[] }>('/events/', {
		dataset: 'errors',
		query: `trace:${traceId}`,
		field: ['project', 'title'],
		statsPeriod: args.since,
	});
	for (const row of errors.data) found.add(`${row.project} error "${row.title}"`);
	for (const [slug, id] of Object.entries(PROJECTS)) {
		// The spans dataset needs the numeric id; a `project:<slug>` filter in the query matches nothing.
		const spans = await get<{ data: { transaction: string }[] }>('/events/', {
			dataset: 'spans',
			project: id,
			query: `trace:${traceId} is_transaction:true`,
			field: ['transaction'],
			statsPeriod: args.since,
			per_page: '20',
		});
		for (const row of spans.data) found.add(`${slug} transaction "${row.transaction}"`);
	}
	return [...found];
}

/** Original source: a path into `src/`, `server/src/`, or a Swift file, with a line. Bundles and addresses fail. */
function readable(frame: Frame): boolean {
	const name = frame.filename ?? frame.absPath ?? '';
	if (!frame.lineNo || /_app\/immutable|\.js$|^0x|^native$|^<unknown>/.test(name)) return false;
	return /(^|\/)(src|Sources)\/.+\.(ts|svelte)$|\.swift$/.test(name);
}

const repoFiles = (await Bun.$`git ls-files`.cwd(new URL('..', import.meta.url).pathname).text()).split('\n');

/**
 * The repository file a frame names, by the longest path suffix, and the text on its line. A line that does not hold
 * the smoke's `throw` means the frame was not mapped back to source, as with the Vite dev server's transformed modules.
 */
async function sourceLine(frame: Frame): Promise<string | null> {
	const parts = (frame.filename ?? frame.absPath ?? '')
		.replace(/^[a-z]+:\/+/, '')
		.split('/')
		.filter(part => part && part !== '..');
	for (let start = 0; start < parts.length; start++) {
		const suffix = parts.slice(start).join('/');
		const file = repoFiles.find(path => path === suffix || path.endsWith(`/${suffix}`));
		if (!file) continue;
		const text = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
		const lines = text.split('\n');
		const line = frame.lineNo ?? 0;
		// A native caller frame holds a return address, which can resolve to the line after the call.
		return lines.slice(Math.max(0, line - 2), line).join('\n');
	}
	return null;
}

/** The exception's frames, or for an iOS exception that was never raised, the capturing thread's. */
function inAppFrames(event: Event): Frame[] {
	const stack = (type: 'exception' | 'threads') => {
		const entry = event.entries.find(item => item.type === type) as Extract<Entry, { type: 'exception' }> | undefined;
		const values = (entry?.data.values ?? []) as { stacktrace: { frames: Frame[] } | null; current?: boolean }[];
		return values
			.filter(value => type === 'exception' || value.current)
			.flatMap(value => value.stacktrace?.frames ?? []);
	};
	const frames = stack('exception').length ? stack('exception') : stack('threads');
	return frames.filter(frame => frame.inApp).reverse();
}

let failed = false;
const check = (ok: boolean, label: string) => {
	if (!ok) failed = true;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
};

for (const smoke of expected) {
	const { title, project } = SMOKES[smoke];
	const event = await latestEvent(smoke);
	console.log(`\n${smoke}: ${project}`);
	if (!event) {
		check(false, `no "${title}" event in ${args.environment} within ${args.since}`);
		continue;
	}
	const traceId = event.contexts.trace?.trace_id ?? null;
	console.log(`  event ${event.eventID} at ${event.dateCreated}`);
	console.log(`  environment ${tag(event, 'environment')}, release ${tag(event, 'release')}`);
	console.log(`  user ${event.user?.id ?? '-'} ${event.user?.email ?? '-'}`);
	console.log(`  trace ${traceId ?? '-'}`);
	check(tag(event, 'environment') === args.environment, `environment is ${args.environment}`);
	check(Boolean(tag(event, 'release')), 'has a release');
	check(Boolean(event.user?.id && event.user.email), 'names the user by id and email');

	const neighbors = traceId ? await traceNeighbors(traceId) : [];
	for (const item of neighbors) console.log(`    in trace: ${item}`);
	const elsewhere = neighbors.filter(item => !item.startsWith(project));
	check(elsewhere.length > 0, 'another project reported into the same trace');

	const frames = inAppFrames(event).slice(0, 3);
	for (const frame of frames) {
		console.log(`    frame ${frame.function ?? '?'} ${frame.filename ?? frame.absPath}:${frame.lineNo ?? '?'}`);
	}
	check(frames.length > 0 && frames.every(readable), 'top in-app frames name original source files and lines');
	const thrown = frames[0] ? await sourceLine(frames[0]) : null;
	console.log(`    line ${frames[0]?.lineNo ?? '?'} in the checkout: ${thrown?.split('\n').at(-1)?.trim() ?? '-'}`);
	check(Boolean(thrown?.includes('Sentry smoke test')), "the top frame's line is the smoke's throw in this checkout");

	if (smoke === 'worker' || smoke === 'account') {
		const request = event.entries.find(entry => entry.type === 'request') as Extract<Entry, { type: 'request' }>;
		console.log(`    request headers: ${(request?.data.headers ?? []).map(([name]) => name).join(', ') || '-'}`);
		check(Boolean(request?.data.headers?.length), 'carries the request headers');
	}
}

if (failed) {
	console.log('\nFAILED');
	process.exit(1);
}
console.log('\nAll checks passed');
