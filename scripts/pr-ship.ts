/**
 * Drives the current branch's open PR to a verdict: `bun scripts/pr-ship.ts [--merge] [--budget seconds]`.
 * Waits for CI and for Codex's first review, then exits with what to do next. It stops before its budget (default 540s,
 * under the 600s tool limit), so rerun it in the foreground until it exits 0; never end the turn while a PR waits.
 *
 *   0  ready, or merged with --merge
 *   1  something to fix: failing checks or unresolved review threads (printed)
 *   2  conflicts with master: rebase onto origin/master, push, rerun
 *   3  budget spent while checks or Codex still run: rerun
 *
 * Codex reviews only when a PR opens, so after the first review it never waits for another.
 */
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	options: { merge: { type: 'boolean' }, budget: { type: 'string', default: '540' } },
});
const budget = Number(values.budget);
if (!Number.isFinite(budget) || budget <= 0)
	throw new Error(`--budget must be a number of seconds, not "${values.budget}"`);
const deadline = Date.now() + budget * 1000;
const CODEX_NUDGE_MS = 15 * 60_000;
const POLL_MS = 20_000;

function run(cmd: string[]): string {
	const result = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`\`${cmd.join(' ')}\` failed\n${result.stderr}${result.stdout}`);
	return result.stdout.trim();
}

type Check = {
	__typename: string;
	name?: string;
	context?: string;
	status?: string;
	conclusion?: string;
	state?: string;
	detailsUrl?: string;
	targetUrl?: string;
};
type Pr = {
	number: number;
	url: string;
	state: string;
	createdAt: string;
	headRefOid: string;
	mergeable: string;
	statusCheckRollup: Check[];
	comments: { author: { login: string }; body: string }[];
};

function exit(code: number, message: string): never {
	console.log(message);
	process.exit(code);
}

const head = run(['git', 'rev-parse', 'HEAD']);
const [owner, repo] = run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).split('/');

function view(): Pr {
	try {
		return JSON.parse(
			run(['gh', 'pr', 'view', '--json', 'number,url,state,createdAt,headRefOid,mergeable,statusCheckRollup,comments']),
		);
	} catch (error) {
		if (error instanceof Error && error.message.includes('no pull requests found')) {
			exit(1, 'This branch has no PR. Push it and open one with `gh pr create`, then rerun.');
		}
		throw error;
	}
}

function checks(pr: Pr) {
	const all = pr.statusCheckRollup.map(check => ({
		name: check.name ?? check.context ?? '?',
		done: check.__typename === 'StatusContext' ? check.state !== 'PENDING' : check.status === 'COMPLETED',
		ok: ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion ?? check.state ?? ''),
		url: check.detailsUrl ?? check.targetUrl ?? '',
	}));
	return { all, failed: all.filter(check => check.done && !check.ok), pending: all.filter(check => !check.done) };
}

// The summary's has_unresolved_findings never clears after the threads resolve, so findings come from the threads.
function codexRunning(pr: Pr): boolean {
	const summary = pr.comments.find(comment => comment.body.includes('codex-review-state:v1'));
	const state = summary?.body.match(/codex-review-state:v1 (\{.*?\}) -->/)?.[1];
	if (!state) return true;
	return (JSON.parse(state).code_review as { status: string | null }).status !== 'completed';
}

function unresolvedThreads(number: number) {
	const query = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved path line comments(first:1){nodes{author{login} body url}}}}}}}`;
	const data = JSON.parse(
		run([
			'gh',
			'api',
			'graphql',
			'-f',
			`query=${query}`,
			'-F',
			`owner=${owner}`,
			'-F',
			`repo=${repo}`,
			'-F',
			`number=${number}`,
		]),
	);
	type Thread = {
		isResolved: boolean;
		path: string;
		line: number | null;
		comments: { nodes: { author: { login: string }; body: string; url: string }[] };
	};
	return (data.data.repository.pullRequest.reviewThreads.nodes as Thread[])
		.filter(thread => !thread.isResolved)
		.map(thread => {
			const comment = thread.comments.nodes[0]!;
			return `- ${thread.path}:${thread.line ?? '?'} (${comment.author.login}) ${comment.body.split('\n')[0]!.slice(0, 200)}\n  ${comment.url}`;
		});
}

while (true) {
	const pr = view();
	if (pr.state === 'MERGED') exit(0, `Merged: ${pr.url}`);
	if (pr.state === 'CLOSED') exit(1, `${pr.url} is closed.`);
	if (pr.headRefOid !== head)
		exit(1, `The PR head is ${pr.headRefOid.slice(0, 7)} but HEAD is ${head.slice(0, 7)}. Push, then rerun.`);
	if (pr.mergeable === 'CONFLICTING') {
		exit(
			2,
			`${pr.url} conflicts with master, so CI will not run. Rebase onto origin/master (a migration conflict means deleting your migration and rerunning \`bun run db:generate\`), push, rerun.`,
		);
	}

	const { all, failed, pending } = checks(pr);
	if (failed.length) {
		exit(
			1,
			`Failing checks:\n${failed.map(check => `- ${check.name} ${check.url}`).join('\n')}\nRead logs with \`gh run view <run id> --log-failed\`, fix the cause, push, rerun.`,
		);
	}
	const threads = unresolvedThreads(pr.number);
	if (threads.length) {
		exit(1, `Unresolved review threads:\n${threads.join('\n')}\nFix or answer each, resolve the thread, push, rerun.`);
	}

	const waiting = [
		...(all.length ? [] : ['checks to start']),
		...pending.map(check => check.name),
		...(codexRunning(pr) ? ['Codex review'] : []),
	];
	if (!waiting.length && pr.mergeable === 'MERGEABLE') {
		if (!values.merge) exit(0, `Ready to merge: ${pr.url}`);
		run(['gh', 'pr', 'merge', String(pr.number), '--merge']);
		continue;
	}
	if (!waiting.length) waiting.push('GitHub to compute mergeability');
	if (Date.now() + POLL_MS > deadline) {
		const nudge =
			waiting.includes('Codex review') && Date.now() - Date.parse(pr.createdAt) > CODEX_NUDGE_MS
				? ' Codex has not reviewed after 15 minutes: comment `@codex review` on the PR once.'
				: '';
		exit(3, `Still waiting on ${waiting.join(', ')}.${nudge} Rerun.`);
	}
	console.log(`Waiting on ${waiting.join(', ')}…`);
	await Bun.sleep(POLL_MS);
}
