import agentOpenApi from '../../shared/api/generated/agent-openapi.json';

/**
 * The docs an AI agent reads. `/api/docs` is public so an agent that only knows the host finds its way in;
 * `/api/docs/agent` and `/api/docs/openapi` need a token and cover exactly `agentContract`, read from the OpenAPI
 * document `bun run generate` writes from it.
 */

type Operation = { summary?: string; description?: string };
const paths = agentOpenApi.paths as Record<string, Record<string, Operation>>;

/** Every route the agent may call, as `METHOD /path`, in the generated document's order. */
export const agentRoutes = Object.entries(paths).flatMap(([path, methods]) =>
	Object.entries(methods).map(([method, operation]) => ({ method: method.toUpperCase(), path, ...operation })),
);

export type Example = {
	title: string;
	method: string;
	path: string;
	query?: Record<string, string>;
	body?: unknown;
};

/** Stand in for a real task and comment id in the examples; the docs test swaps in ones it made. */
export const TASK_ID = '<task-id>';
export const COMMENT_ID = '<comment-id>';

/** One per agent route at least. The docs test runs every one against a real space with an AI token. */
export const agentExamples: readonly Example[] = [
	{ title: 'See everything in the space', method: 'GET', path: '/api/view' },
	{
		title: 'Add a task the way the app’s quick add reads it',
		method: 'POST',
		path: '/api/tasks',
		body: { text: 'Call the plumber tomorrow 5pm p1' },
	},
	{
		title: 'Add a subtask with explicit fields',
		method: 'POST',
		path: '/api/tasks',
		body: { title: 'Buy washers', parentId: TASK_ID, priority: 2, notes: 'The 1/2 inch ones' },
	},
	{
		title: 'Edit a task: rename it, move its date, clear its priority',
		method: 'PATCH',
		path: '/api/tasks',
		query: { id: TASK_ID },
		body: { title: 'Call the plumber about the sink', due: { date: '2026-10-20', time: '09:00' }, priority: 4 },
	},
	{ title: 'Complete a task', method: 'POST', path: '/api/tasks/complete', query: { id: TASK_ID } },
	{ title: 'Reopen it', method: 'POST', path: '/api/tasks/reopen', query: { id: TASK_ID } },
	{ title: 'Read who did what to a task', method: 'GET', path: '/api/activity', query: { id: TASK_ID } },
	{
		title: 'Comment on a task',
		method: 'POST',
		path: '/api/comments',
		body: { taskId: TASK_ID, body: 'Booked the plumber for Tuesday 9am' },
	},
	{ title: 'Read a task’s comments', method: 'GET', path: '/api/comments', query: { id: TASK_ID } },
	{
		title: 'Edit your comment',
		method: 'PATCH',
		path: '/api/comments',
		query: { id: COMMENT_ID },
		body: { body: 'Booked the plumber for Tuesday 10am' },
	},
	{ title: 'Delete your comment', method: 'DELETE', path: '/api/comments', query: { id: COMMENT_ID } },
	{ title: 'Delete a task and its subtasks', method: 'DELETE', path: '/api/tasks', query: { id: TASK_ID } },
	{
		title: 'Sync from scratch, as the apps do',
		method: 'POST',
		path: '/api/sync',
		body: { cursor: 0, ops: [] },
	},
];

/** Unencoded, so the `<task-id>` placeholder reads as one. Real ids are URL safe. */
export const examplePath = ({ path, query }: Example) =>
	query
		? `${path}?${Object.entries(query)
				.map(([key, value]) => `${key}=${value}`)
				.join('&')}`
		: path;

function curl(origin: string, example: Example): string {
	const parts = [`curl -X ${example.method} "${origin}${examplePath(example)}"`, '-H "Authorization: Bearer $TOKEN"'];
	if (example.body !== undefined) {
		parts.push(`-H 'Content-Type: application/json'`, `-d '${JSON.stringify(example.body)}'`);
	}
	return parts.join(' \\\n  ');
}

export function startDocs(origin: string): string {
	return `# ProcrastiMate

ProcrastiMate is a personal task manager in the spirit of Todoist: tasks with due dates and times, repeats, priorities, reminders, and subtasks, sorted into projects and labels. Its owner can give an AI agent an account of its own that reads and changes their tasks over this HTTP API. Everything the agent does is credited to it in the owner's apps.

## Get a token

An agent cannot sign up or sign in. Ask the owner to open Settings in the ProcrastiMate app, add an AI account under AI accounts, and press Generate token. The token looks like \`pm.<ownerId>.<secret>\`, is shown once, and stops working when the owner deletes the account.

## Authenticate

Send the token on every request:

\`\`\`
Authorization: Bearer pm.<ownerId>.<secret>
\`\`\`

JSON bodies also need \`Content-Type: application/json\`.

## Read the reference

With the token, these list every route it may use:

- \`GET ${origin}/api/docs/agent\`: a guide with an example per route, in Markdown.
- \`GET ${origin}/api/docs/openapi\`: the same routes as OpenAPI 3.1.

\`\`\`
curl -H "Authorization: Bearer $TOKEN" ${origin}/api/docs/agent
\`\`\`
`;
}

function routeTable(): string {
	const rows = agentRoutes.map(
		route =>
			`| ${route.method} | \`${route.path}\` | ${[route.summary, route.description].filter(Boolean).join('. ')} |`,
	);
	return ['| Method | Path | What it does |', '| --- | --- | --- |', ...rows].join('\n');
}

export function agentDocs(origin: string): string {
	const examples = agentExamples.map(example => `### ${example.title}\n\n\`\`\`\n${curl(origin, example)}\n\`\`\``);
	return `# ProcrastiMate agent API

Base URL: \`${origin}\`. Send \`Authorization: Bearer <token>\` on every request and \`Content-Type: application/json\` with every body. You act as your AI account in your owner's whole space, and may edit every task in it. The apps show what you create, complete, or change as yours.

The full schemas, as OpenAPI 3.1, are at \`GET ${origin}/api/docs/openapi\`.

## Routes

These are the only routes a token may call. Every other route answers \`403 FORBIDDEN\`.

${routeTable()}

Routes that take a task use \`?id=<task id>\`; editing or deleting a comment takes \`?id=<comment id>\`. Ids come from \`GET /api/view\` or from the task a route returns. \`?space=\` is optional and defaults to the owner's space, the only one an AI account can reach.

## Tasks

- \`title\` is one line and \`notes\` is free text; links in either open in the apps.
- \`due\` is \`{ "date": "YYYY-MM-DD", "time": "HH:mm" | null }\` in the owner's time zone, or \`null\` for no date.
- \`priority\` is 1 (most urgent) to 4 (none).
- \`completedAt\` is epoch milliseconds, or \`null\` while the task is open.
- \`parentId\` makes a subtask. Deleting a task deletes its subtasks.
- \`text\` on \`POST /api/tasks\` reads like the app's quick add, for example \`Water the plants every 2 weeks p2\` or \`Email Sam fri 10am remind me 30m before\`. Phrases it recognizes are removed from the title. Explicit fields such as \`title\` or \`priority\` win over what it parsed.

## Comments

- Comments are how you talk with the people on a task. The owner and anyone the task is shared with see them in the apps, with your name and an \`AI\` badge, and unread ones light up on the task's row.
- \`body\` is free text; links in it open in the apps. You may edit or delete only your own comments.

## Projects and labels

Read them from \`GET /api/view\`. Put a task in an existing one with \`#Project\` or \`@label\` in \`text\`, or with \`projectId\` and \`labelIds\`.

An AI account cannot create, rename, or delete projects or labels: the API has no route for it, and sync drops such ops. Ask the owner to make them in the app. A \`#name\` or \`@name\` that matches nothing stays in the task's title.

## Examples

\`$TOKEN\` is your token and \`${TASK_ID}\` a task id from \`GET /api/view\`.

${examples.join('\n\n')}

## Errors

Errors are JSON \`{ "code", "message" }\`:

- \`400 BAD_REQUEST\`: the input does not match the schema, or a new task has no title.
- \`401 UNAUTHORIZED\`: the token is missing, wrong, or revoked.
- \`403 FORBIDDEN\`: the route is not open to AI accounts, or the change touches something you may not edit.
- \`404 NOT_FOUND\`: no task with that id is visible to you.

## Sync

\`POST /api/sync\` is how the apps replicate. Most agents never need it, since \`GET /api/view\` and the task routes cover reading and editing. Send \`{ "cursor": 0, "ops": [] }\` to receive the whole visible snapshot with a \`cursor\` and a \`scope\`. Send that \`scope\` back next time to receive no changes while nothing you can see moved. Each op carries a fresh \`opId\` and a hybrid logical clock \`hlc\`; field-level last-writer-wins resolves conflicts. Task ops are applied when the task is editable before and after; project, label, and settings ops are acknowledged and dropped.
`;
}

/** What Settings copies for the owner to paste into an AI assistant along with a new token. */
export function agentPrompt(origin: string, token: string): string {
	return `You can read and manage my tasks in ProcrastiMate, my task manager, through its HTTP API. Authenticate every request with the header \`Authorization: Bearer ${token}\`. Start by reading the API guide at ${origin}/api/docs/agent with that header; it lists every route you may call, with examples. Keep the token secret.`;
}

export function agentOpenApiFor(origin: string) {
	return { ...agentOpenApi, servers: [{ url: origin }] };
}
