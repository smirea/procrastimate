import type { FeedbackPost } from '../../shared/api/contract';

/**
 * The Feedback editor's GitHub Issue webhook: each post becomes an issue in this repository, opened by the token's
 * account. Ported from feedback-engine's `examples/github-webhook/worker.ts`; the router decides who may post.
 */
export const FEEDBACK_REPO = 'smirea/procrastimate';
export const FEEDBACK_LABELS = ['feedback'];

/** GitHub's limit for an issue's body and for a comment is 65,536 characters. */
const BODY_LIMIT = 65_000;
const TIMEOUT_MS = 20_000;

type Report = {
	environment?: { name: string; value: string }[];
	items?: { number: number; text: string; title: string; code?: string }[];
};

async function github(token: string, method: string, url: string, body?: BodyInit, type = 'application/json') {
	const response = await fetch(url, {
		method,
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'user-agent': 'ProcrastiMate',
			'x-github-api-version': '2022-11-28',
			...(body ? { 'content-type': type } : {}),
		},
	});
	if (!response.ok) {
		const text = (await response.text()).slice(0, 300);
		throw new Error(`GitHub answered ${response.status} to ${method} ${new URL(url).pathname}: ${text}`);
	}
	return (await response.json()) as Record<string, unknown>;
}

/** A fence longer than any run of backticks inside, so the text cannot close it. */
function fenced(text: string, language = '') {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
	const fence = '`'.repeat(Math.max(3, longest + 1));
	return `${fence}${language}\n${text}\n${fence}`;
}

const quoted = (text: string) =>
	text
		.split(/\r?\n/)
		.map(line => `> ${line}`)
		.join('\n');

const collapsed = (summary: string, text: string) =>
	`<details>\n<summary>${summary}</summary>\n\n${fenced(text, 'json')}\n\n</details>`;

function issueBody(id: string, title: string, image: string, report: Report) {
	const items = (report.items ?? []).map(
		item => `**${item.number}. ${item.title}**${item.code ? ` · \`${item.code}\`` : ''}\n\n${quoted(item.text)}`,
	);
	const environment = (report.environment ?? []).map(entry => `${entry.name}: ${entry.value}`).join(' · ');
	return [`![${title}](${image})`, ...items, environment, `<!-- feedback post ${id} -->`].filter(Boolean).join('\n\n');
}

const CUT = '\n\n…cut here. `feedback.json` in the comments has every item in full.';

/** Items' own text can pass the limit, and GitHub rejects the issue then; the report in the comments keeps all of it. */
const bounded = (body: string) => (body.length <= BODY_LIMIT ? body : body.slice(0, BODY_LIMIT - CUT.length) + CUT);

/** Files the post and answers the issue's address. Throws with GitHub's answer when any step fails. */
export async function fileFeedbackIssue(token: string, post: FeedbackPost): Promise<string> {
	const json = await post.report.text();
	const report = JSON.parse(json) as Report;
	const api = `https://api.github.com/repos/${FEEDBACK_REPO}`;
	const repository = await github(token, 'GET', api);
	// The endpoint the GitHub CLI's `--attach` uses. It takes a token that can write to the repository.
	const upload = new URL('https://uploads.github.com/user-attachments/assets');
	upload.search = String(
		new URLSearchParams({ name: 'feedback.png', content_type: 'image/png', repository_id: String(repository.id) }),
	);
	const asset = await github(token, 'POST', upload.href, await post.image.arrayBuffer(), 'application/octet-stream');

	const body = issueBody(post.id, post.title, asset.url as string, report);
	const whole = `${body}\n\n${collapsed('feedback.json', json)}`;
	const issue = await github(
		token,
		'POST',
		`${api}/issues`,
		JSON.stringify({
			title: post.title,
			body: whole.length <= BODY_LIMIT ? whole : bounded(body),
			labels: FEEDBACK_LABELS,
		}),
	);
	// A report too long for the issue's body goes into comments, in parts that join back into the file.
	if (whole.length > BODY_LIMIT) {
		const size = BODY_LIMIT - 1000;
		const parts = Math.ceil(json.length / size);
		for (let part = 0; part < parts; part++) {
			const comment = collapsed(
				`feedback.json, part ${part + 1} of ${parts}`,
				json.slice(part * size, (part + 1) * size),
			);
			// In order, so the parts read top to bottom as the file.
			// oxlint-disable-next-line no-await-in-loop
			await github(token, 'POST', `${api}/issues/${issue.number}/comments`, JSON.stringify({ body: comment }));
		}
	}
	return issue.html_url as string;
}
