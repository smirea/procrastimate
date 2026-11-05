import { z } from 'zod';

/**
 * GitHub issues and pull requests a task carries as metadata. The task stores only which ones, as `GithubRef`s; their
 * title and state are read live through the server, since a PR's state changes after it is attached. See
 * `docs/decisions/integrations.md`.
 */

const REPO = /^[\w.-]+\/[\w.-]+$/;

export const GITHUB_KINDS = ['issue', 'pull'] as const;
export const githubKindSchema = z.enum(GITHUB_KINDS).meta({ id: 'GithubKind' });
export type GithubKind = z.infer<typeof githubKindSchema>;

export const githubRefSchema = z
	.object({
		/** `owner/name`, as GitHub spells it in the URL. */
		repo: z.string().regex(REPO),
		number: z.number().int().positive(),
		kind: githubKindSchema,
	})
	.meta({ id: 'GithubRef', description: 'A GitHub issue or pull request attached to a task.' });
export type GithubRef = z.infer<typeof githubRefSchema>;

export const GITHUB_STATES = ['open', 'draft', 'merged', 'closed'] as const;
export const githubStateSchema = z.enum(GITHUB_STATES).meta({ id: 'GithubState' });
export type GithubState = z.infer<typeof githubStateSchema>;

export const githubItemSchema = z
	.object({ title: z.string().nullable(), state: githubStateSchema.nullable(), kind: githubKindSchema })
	.meta({
		id: 'GithubItem',
		description:
			'An attached issue or pull request as GitHub has it now. Both are null when GitHub cannot be read; `state` alone is null when only the page title could be. `kind` is what GitHub says, which corrects an issue link to a pull request.',
	});
export type GithubItem = z.infer<typeof githubItemSchema>;

const URL_PATTERN =
	/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)(?:[/?#][^\s]*)?$/i;
const SHORT_PATTERN = /^([\w.-]+\/[\w.-]+)#(\d+)$/;

/**
 * An issue or pull request from what was pasted: its GitHub URL, a page under it such as `/files`, or `owner/repo#12`,
 * which reads as an issue since GitHub sends an issue URL on to the pull request.
 */
export function parseGithubRef(text: string): GithubRef | null {
	const trimmed = text.trim();
	const url = URL_PATTERN.exec(trimmed);
	const short = SHORT_PATTERN.exec(trimmed);
	const ref = url
		? { repo: url[1], number: Number(url[3]), kind: url[2]!.toLowerCase() === 'pull' ? 'pull' : 'issue' }
		: short && { repo: short[1], number: Number(short[2]), kind: 'issue' };
	return githubRefSchema.safeParse(ref).data ?? null;
}

export const githubUrl = (ref: GithubRef) =>
	`https://github.com/${ref.repo}/${ref.kind === 'pull' ? 'pull' : 'issues'}/${ref.number}`;

/** `procrastimate#309`: the repo's name without its owner, as a row has room for. */
export const githubLabel = (ref: GithubRef) => `${ref.repo.split('/')[1]}#${ref.number}`;

export const sameGithubRef = (a: GithubRef, b: GithubRef) =>
	a.repo.toLowerCase() === b.repo.toLowerCase() && a.number === b.number;

/** Adds a ref unless the task already has it, and keeps the order they were attached in. */
export const withGithubRef = (refs: GithubRef[], ref: GithubRef) =>
	refs.some(r => sameGithubRef(r, ref)) ? refs : [...refs, ref];
