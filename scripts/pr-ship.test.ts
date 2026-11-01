import { expect, test } from 'bun:test';
import { TimeoutError } from './lib';
import { type Io, type Pr, ship } from './pr-ship';

const HEAD = 'abc1234def';
const MINUTE = 60_000;
const SUMMARY_DONE = '<!-- codex-review-state:v1 {"code_review":{"status":"completed"}} -->';

type Call = { cmd: string; env?: Record<string, string> };

/**
 * A GitHub on a fake clock. `durations` maps a command prefix (`gh pr merge`) to how long it takes, so a test can
 * make any phase slow. Commands honor `timeoutMs` the way `run` does: they burn the timeout, then throw.
 */
function fakeGitHub({
	start = Date.parse('2026-10-31T12:00:00Z'),
	createdAt = start,
	checksDoneAt = 0,
	codexDoneAt = 0,
	comments = [],
	ownerToken = 'owner-token',
	durations = {},
}: {
	start?: number;
	createdAt?: number;
	checksDoneAt?: number;
	codexDoneAt?: number;
	comments?: Pr['comments'];
	ownerToken?: string | null;
	durations?: Record<string, number>;
} = {}) {
	let now = start;
	let state = 'OPEN';
	const calls: Call[] = [];
	const elapsed = () => now - start;
	const pr = (): Pr => ({
		number: 7,
		url: 'https://github.com/smirea/procrastimate/pull/7',
		state,
		createdAt: new Date(createdAt).toISOString(),
		headRefOid: HEAD,
		mergeable: 'MERGEABLE',
		statusCheckRollup: [
			elapsed() >= checksDoneAt
				? { __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }
				: { __typename: 'CheckRun', name: 'ci', status: 'IN_PROGRESS' },
		],
		comments: [
			...comments,
			...(elapsed() >= codexDoneAt
				? [{ author: { login: 'chatgpt-codex-connector' }, body: SUMMARY_DONE, createdAt: '' }]
				: []),
		],
	});
	const answer = (cmd: string): string => {
		if (cmd === 'git rev-parse HEAD') return HEAD;
		if (cmd.startsWith('gh repo view')) return 'smirea/procrastimate';
		if (cmd.startsWith('gh pr view')) return JSON.stringify(pr());
		if (cmd.startsWith('gh api graphql'))
			return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
		if (cmd.startsWith('gh pr merge')) {
			state = 'MERGED';
			return '';
		}
		if (cmd === 'gh auth token --user smirea') {
			if (!ownerToken) throw new Error('`gh auth token --user smirea` failed\nno oauth token found for smirea');
			return ownerToken;
		}
		if (cmd.startsWith('gh pr comment')) {
			comments.push({ author: { login: 'smirea' }, body: '@codex review', createdAt: new Date(now).toISOString() });
			return '';
		}
		throw new Error(`unexpected command: ${cmd}`);
	};
	const io: Io = {
		now: () => now,
		sleep: async ms => {
			now += ms;
		},
		run: (cmd, options = {}) => {
			const line = cmd.join(' ');
			calls.push({ cmd: line, env: options.env });
			const duration = Object.entries(durations).find(([prefix]) => line.startsWith(prefix))?.[1] ?? 1000;
			if (options.timeoutMs !== undefined && duration > options.timeoutMs) {
				now += options.timeoutMs;
				throw new TimeoutError(`\`${line}\` ran past ${options.timeoutMs}ms`);
			}
			now += duration;
			return answer(line);
		},
		log: () => {},
	};
	return { io, calls, elapsed };
}

const BUDGET_MS = 500_000;

for (const [phase, durations, checksDoneAt] of [
	['the merge', { 'gh pr merge': 120_000 }, 470_000],
	['a CI poll', { 'gh pr view': 90_000 }, 480_000],
	['the review-thread poll', { 'gh api graphql': 200_000 }, 300_000],
	['the first look at the PR', { 'gh pr view': 900_000 }, 0],
] as const) {
	test(`a slow ${phase} still exits before the budget runs out`, async () => {
		const github = fakeGitHub({ checksDoneAt, durations });
		const verdict = await ship(github.io, { merge: true, budgetMs: BUDGET_MS });
		expect(github.elapsed()).toBeLessThanOrEqual(BUDGET_MS);
		expect(verdict.code).toBe(3);
		expect(verdict.message).toContain('Rerun');
	});
}

test('merges a green PR and exits 0', async () => {
	const github = fakeGitHub({ checksDoneAt: 60_000 });
	expect(await ship(github.io, { merge: true, budgetMs: BUDGET_MS })).toEqual({
		code: 0,
		message: 'Merged: https://github.com/smirea/procrastimate/pull/7',
	});
});

test('nudges Codex once from the repository owner account after 15 minutes', async () => {
	const comments: Pr['comments'] = [];
	const start = Date.parse('2026-10-31T12:00:00Z');
	const github = fakeGitHub({ start, createdAt: start - 16 * MINUTE, codexDoneAt: Infinity, comments });
	const verdict = await ship(github.io, { merge: true, budgetMs: BUDGET_MS });

	const nudges = github.calls.filter(call => call.cmd.startsWith('gh pr comment'));
	expect(nudges).toEqual([{ cmd: 'gh pr comment 7 --body @codex review', env: { GH_TOKEN: 'owner-token' } }]);
	expect(verdict.code).toBe(3);
	expect(verdict.message).toBe('Still waiting on Codex review. Asked Codex to review as smirea. Rerun.');

	const rerun = fakeGitHub({
		start: start + 10 * MINUTE,
		createdAt: start - 16 * MINUTE,
		codexDoneAt: Infinity,
		comments,
	});
	await ship(rerun.io, { merge: true, budgetMs: BUDGET_MS });
	expect(rerun.calls.filter(call => call.cmd.startsWith('gh pr comment'))).toEqual([]);
});

test('needs input when Codex is overdue and the owner account is not logged in', async () => {
	const start = Date.parse('2026-10-31T12:00:00Z');
	const github = fakeGitHub({ start, createdAt: start - 16 * MINUTE, codexDoneAt: Infinity, ownerToken: null });
	const verdict = await ship(github.io, { merge: true, budgetMs: BUDGET_MS });
	expect(github.calls.filter(call => call.cmd.startsWith('gh pr comment'))).toEqual([]);
	expect(verdict).toEqual({
		code: 4,
		message:
			'Codex has not reviewed https://github.com/smirea/procrastimate/pull/7 after 15 minutes, and Codex answers only smirea, whose gh login is missing here. Report needs_input: ask smirea to comment `@codex review` on the PR.',
	});
});

test('needs input when Codex still has not reviewed 15 minutes after the nudge', async () => {
	const start = Date.parse('2026-10-31T12:00:00Z');
	const comments: Pr['comments'] = [
		{ author: { login: 'smirea' }, body: '@codex review', createdAt: new Date(start - 16 * MINUTE).toISOString() },
	];
	const github = fakeGitHub({ start, createdAt: start - 40 * MINUTE, codexDoneAt: Infinity, comments });
	const verdict = await ship(github.io, { merge: true, budgetMs: BUDGET_MS });
	expect(github.calls.filter(call => call.cmd.startsWith('gh pr comment'))).toEqual([]);
	expect(verdict).toEqual({
		code: 4,
		message:
			'Codex has not reviewed https://github.com/smirea/procrastimate/pull/7 15 minutes after smirea asked it to. Report needs_input: ask smirea to check the Codex integration.',
	});
});
