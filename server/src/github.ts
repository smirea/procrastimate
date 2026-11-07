import { githubUrl, type GithubItem, type GithubRef, type GithubState } from '../../shared/github';
import { linkTitle } from './link-preview';

const API = 'https://api.github.com';
const TIMEOUT_MS = 5000;

type IssueJson = {
	title?: unknown;
	state?: unknown;
	draft?: unknown;
	pull_request?: { merged_at?: unknown } | null;
};

function stateOf(issue: IssueJson): GithubState | null {
	if (issue.state !== 'open' && issue.state !== 'closed') return null;
	if (!issue.pull_request) return issue.state;
	if (issue.pull_request.merged_at) return 'merged';
	return issue.state === 'open' && issue.draft === true ? 'draft' : issue.state;
}

/**
 * The issue or pull request as GitHub's API has it. Its issues route answers both, with `pull_request` set on a PR.
 * Null when it cannot be read: a private repo without a token, a signed-out read past GitHub's 60 an hour per address
 * (shared by every Worker on it), or no answer in time.
 */
async function readGithub(ref: GithubRef, token: string | null): Promise<GithubItem | null> {
	const response = await fetch(`${API}/repos/${ref.repo}/issues/${ref.number}`, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: {
			accept: 'application/vnd.github+json',
			'user-agent': 'ProcrastiMate',
			'x-github-api-version': '2022-11-28',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
	}).catch(() => null);
	if (!response?.ok) {
		await response?.body?.cancel();
		return null;
	}
	const issue = (await response.json().catch(() => null)) as IssueJson | null;
	if (!issue || typeof issue.title !== 'string') return null;
	return { title: issue.title.trim() || null, state: stateOf(issue), kind: issue.pull_request ? 'pull' : 'issue' };
}

/** From the API, else the title on its page with no state, which still reads a public one past the rate limit. */
export async function githubItem(ref: GithubRef, token: string | null): Promise<GithubItem> {
	return (await readGithub(ref, token)) ?? { title: await linkTitle(githubUrl(ref)), state: null, kind: ref.kind };
}
