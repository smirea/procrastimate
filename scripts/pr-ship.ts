/**
 * Drives the current branch's open PR to a verdict: `bun scripts/pr-ship.ts [--merge] [--budget seconds]`.
 * Waits for CI and for Codex's first review, then exits with what to do next. The budget (default 540s, under the 600s
 * tool limit) is a hard stop: every `gh` call is killed when it would outlive it. Rerun it in the foreground until it
 * exits 0; never end the turn while a PR waits.
 *
 *   0  ready, or merged with --merge
 *   1  something to fix: failing checks or unresolved review threads (printed)
 *   2  conflicts with master: rebase onto origin/master, push, rerun
 *   3  budget spent while checks or Codex still run, or during a slow `gh` call: rerun
 *   4  needs a human: Codex is overdue and only the repository owner's account can nudge it (printed)
 *
 * Codex reviews only when a PR opens, so after the first review it never waits for another. Codex answers `@codex review`
 * only from the owner's account, so after 15 minutes without a review the script posts it with that account's gh token.
 */
import { parseArgs } from 'node:util';
import { run, TimeoutError } from './lib';

const CODEX_NUDGE_MS = 15 * 60_000;
const POLL_MS = 20_000;
const EXIT_RESERVE_MS = 2_000;

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
export type Pr = {
	number: number;
	url: string;
	state: string;
	createdAt: string;
	headRefOid: string;
	mergeable: string;
	statusCheckRollup: Check[];
	comments: { author: { login: string }; body: string; createdAt: string }[];
};

export type Io = {
	now(): number;
	sleep(ms: number): Promise<void>;
	run(cmd: string[], options?: { timeoutMs?: number; env?: Record<string, string> }): string;
	log(line: string): void;
};
export type Verdict = { code: 0 | 1 | 2 | 3 | 4; message: string };

class Exit extends Error {
	constructor(readonly verdict: Verdict) {
		super(verdict.message);
	}
}
function exit(code: Verdict['code'], message: string): never {
	throw new Exit({ code, message });
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

export async function ship(io: Io, { merge, budgetMs }: { merge: boolean; budgetMs: number }): Promise<Verdict> {
	const deadline = io.now() + budgetMs;
	function bounded(cmd: string[], env?: Record<string, string>): string {
		const timeoutMs = deadline - EXIT_RESERVE_MS - io.now();
		const name = `\`${cmd.slice(0, 3).join(' ')}\``;
		if (timeoutMs <= 0) exit(3, `The budget ran out before ${name}. Rerun.`);
		try {
			return io.run(cmd, { timeoutMs, env });
		} catch (error) {
			if (error instanceof TimeoutError) exit(3, `The budget ran out during ${name}. Rerun.`);
			throw error;
		}
	}
	const gh = (args: string[], env?: Record<string, string>) => bounded(['gh', ...args], env);

	function token(user: string): string | null {
		try {
			return gh(['auth', 'token', '--user', user]) || null;
		} catch (error) {
			if (error instanceof Exit) throw error;
			return null;
		}
	}

	function view(): Pr {
		try {
			return JSON.parse(
				gh(['pr', 'view', '--json', 'number,url,state,createdAt,headRefOid,mergeable,statusCheckRollup,comments']),
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes('no pull requests found')) {
				exit(1, 'This branch has no PR. Push it and open one with `gh pr create`, then rerun.');
			}
			throw error;
		}
	}

	function unresolvedThreads(owner: string, repo: string, number: number) {
		const query = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved path line comments(first:1){nodes{author{login} body url}}}}}}}`;
		const data = JSON.parse(
			gh([
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

	try {
		const head = bounded(['git', 'rev-parse', 'HEAD']);
		let nudged = false;
		const [owner, repo] = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).split('/') as [
			string,
			string,
		];
		while (true) {
			const pr = view();
			if (pr.state === 'MERGED') exit(0, `Merged: ${pr.url}`);
			if (pr.state === 'CLOSED') exit(1, `${pr.url} is closed.`);
			if (pr.headRefOid !== head)
				exit(1, `The PR head is ${pr.headRefOid.slice(0, 7)} but HEAD is ${head.slice(0, 7)}. Push, then rerun.`);
			if (pr.mergeable === 'CONFLICTING') {
				exit(2, `${pr.url} conflicts with master, so CI will not run. Rebase onto origin/master, push, rerun.`);
			}

			const { all, failed, pending } = checks(pr);
			if (failed.length) {
				exit(
					1,
					`Failing checks:\n${failed.map(check => `- ${check.name} ${check.url}`).join('\n')}\nRead logs with \`gh run view <run id> --log-failed\`, fix the cause, push, rerun.`,
				);
			}
			const threads = unresolvedThreads(owner, repo, pr.number);
			if (threads.length) {
				exit(
					1,
					`Unresolved review threads:\n${threads.join('\n')}\nFix or answer each, resolve the thread, push, rerun.`,
				);
			}

			const waiting = [
				...(all.length ? [] : ['checks to start']),
				...pending.map(check => check.name),
				...(codexRunning(pr) ? ['Codex review'] : []),
			];
			if (!waiting.length && pr.mergeable === 'MERGEABLE') {
				if (!merge) exit(0, `Ready to merge: ${pr.url}`);
				gh(['pr', 'merge', String(pr.number), '--merge']);
				continue;
			}
			if (!waiting.length) waiting.push('GitHub to compute mergeability');
			if (waiting.includes('Codex review')) {
				const nudge = pr.comments.find(
					comment => comment.author.login === owner && comment.body.trim() === '@codex review',
				);
				if (nudge && io.now() - Date.parse(nudge.createdAt) > CODEX_NUDGE_MS) {
					exit(
						4,
						`Codex has not reviewed ${pr.url} 15 minutes after ${owner} asked it to. Report needs_input: ask ${owner} to check the Codex integration.`,
					);
				}
				if (!nudge && !nudged && io.now() - Date.parse(pr.createdAt) > CODEX_NUDGE_MS) {
					const ownerToken = token(owner);
					if (!ownerToken) {
						exit(
							4,
							`Codex has not reviewed ${pr.url} after 15 minutes, and Codex answers only ${owner}, whose gh login is missing here. Report needs_input: ask ${owner} to comment \`@codex review\` on the PR.`,
						);
					}
					gh(['pr', 'comment', String(pr.number), '--body', '@codex review'], { GH_TOKEN: ownerToken });
					nudged = true;
				}
			}
			if (io.now() + POLL_MS > deadline) {
				const nudge = nudged ? ` Asked Codex to review as ${owner}.` : '';
				exit(3, `Still waiting on ${waiting.join(', ')}.${nudge} Rerun.`);
			}
			io.log(`Waiting on ${waiting.join(', ')}…`);
			await io.sleep(POLL_MS);
		}
	} catch (error) {
		if (error instanceof Exit) return error.verdict;
		throw error;
	}
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: { merge: { type: 'boolean' }, budget: { type: 'string', default: '540' } },
	});
	const budget = Number(values.budget);
	if (!Number.isFinite(budget) || budget <= 0)
		throw new Error(`--budget must be a number of seconds, not "${values.budget}"`);
	const { code, message } = await ship(
		{ now: Date.now, sleep: Bun.sleep, run: (cmd, options) => run(cmd, options), log: console.log },
		{ merge: Boolean(values.merge), budgetMs: budget * 1000 },
	);
	// The last line names the code, so a `| tail` that swallows the exit status still shows it.
	console.log(`${message}\npr-ship exit ${code}`);
	process.exit(code);
}
