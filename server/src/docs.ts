import agentOpenApi from '../../shared/api/generated/agent-openapi.json';
import { LABEL_COLORS } from '../../shared/label-colors';

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

/** Stand in for real ids in the examples; the docs test swaps in ones it made. */
export const TASK_ID = '<task-id>';
export const COMMENT_ID = '<comment-id>';
export const IMAGE_ID = '<image-id>';
export const PROJECT_ID = '<project-id>';
export const SECTION_ID = '<section-id>';
export const LABEL_ID = '<label-id>';
export const PLACE_ID = '<place-id>';
export const LINK_ID = '<link-id>';

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
	{
		title: 'Download a task’s image, as a thumbnail',
		method: 'GET',
		path: '/api/images',
		query: { id: IMAGE_ID, size: 'thumb' },
	},
	{
		title: 'Publish a task as a read-only link anyone can open',
		method: 'POST',
		path: '/api/links',
		body: { target: { kind: 'task', id: TASK_ID } },
	},
	{ title: 'List the public links', method: 'GET', path: '/api/links' },
	{ title: 'Delete a public link', method: 'DELETE', path: '/api/links', query: { id: LINK_ID } },
	{ title: 'Add a project', method: 'POST', path: '/api/projects', body: { name: 'Garden' } },
	{
		title: 'Rename a project',
		method: 'PATCH',
		path: '/api/projects',
		query: { id: PROJECT_ID },
		body: { name: 'Home repairs' },
	},
	{
		title: 'Move a project first',
		method: 'PATCH',
		path: '/api/projects',
		query: { id: PROJECT_ID },
		body: { index: 0 },
	},
	{
		title: 'Add a section to a project',
		method: 'POST',
		path: '/api/sections',
		body: { projectId: PROJECT_ID, name: 'Next week' },
	},
	{
		title: 'Rename a section and move it first',
		method: 'PATCH',
		path: '/api/sections',
		query: { id: SECTION_ID },
		body: { name: 'This week', index: 0 },
	},
	{ title: 'Add a label', method: 'POST', path: '/api/labels', body: { name: 'waiting', color: 'orange' } },
	{
		title: 'Rename and recolor a label',
		method: 'PATCH',
		path: '/api/labels',
		query: { id: LABEL_ID },
		body: { name: 'blocked', color: 'red' },
	},
	{
		title: 'Save a place',
		method: 'POST',
		path: '/api/labels',
		body: { name: 'gym', place: { address: '1 Main St', latitude: 52.52, longitude: 13.405, radius: 100 } },
	},
	{ title: 'Add a task at a saved place', method: 'POST', path: '/api/tasks', body: { text: 'Stretch @gym' } },
	{
		title: 'Widen a saved place',
		method: 'PATCH',
		path: '/api/labels',
		query: { id: PLACE_ID },
		body: { radius: 250 },
	},
	{ title: 'Delete a section and its tasks', method: 'DELETE', path: '/api/sections', query: { id: SECTION_ID } },
	{ title: 'Delete a label', method: 'DELETE', path: '/api/labels', query: { id: LABEL_ID } },
	{
		title: 'Delete a project with its sections and tasks',
		method: 'DELETE',
		path: '/api/projects',
		query: { id: PROJECT_ID },
	},
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

ProcrastiMate is a personal task manager in the spirit of Todoist: tasks with due dates and times, repeats, priorities, reminders, subtasks, and comments, sorted into projects, sections, and labels. Its owner can give an AI agent an account of its own that reads and changes their tasks, organizes their projects and labels, and publishes read-only links over this HTTP API. Everything the agent does is credited to it in the owner's apps.

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

Base URL: \`${origin}\`. Send \`Authorization: Bearer <token>\` on every request and \`Content-Type: application/json\` with every body. You act as your AI account in your owner's whole space. You may edit every task, project, section, and label in it, and publish read-only links to it. The apps show what you create, complete, or change as yours.

The full schemas, as OpenAPI 3.1, are at \`GET ${origin}/api/docs/openapi\`.

## Routes

These are the only routes a token may call. Every other route answers \`403 FORBIDDEN\`.

${routeTable()}

\`?id=\` names what a route acts on: a task on the task routes, a comment on the comment routes, and likewise an image, project, section, label, or link. Ids come from \`GET /api/view\`, \`GET /api/links\`, or what a route returns. \`?space=\` is optional and defaults to the owner's space, the only one an AI account can reach.

## Tasks

- \`title\` is one line and \`notes\` is free text; links in either open in the apps.
- \`due\` is \`{ "date": "YYYY-MM-DD", "time": "HH:mm" | null }\` in the owner's time zone, or \`null\` for no date.
- \`priority\` is 1 (most urgent) to 4 (none).
- \`completedAt\` is epoch milliseconds, or \`null\` while the task is open.
- \`parentId\` makes a subtask. Deleting a task deletes its subtasks.
- \`images\` lists the task's images as \`{ id, width, height }\`. Download one with \`GET /api/images?id=<image id>&size=full\` or \`size=thumb\`. You can reorder or remove images by sending \`images\` to \`PATCH /api/tasks\`, but not upload new ones.
- \`text\` on \`POST /api/tasks\` reads like the app's quick add, for example \`Water the plants every 2 weeks p2\` or \`Email Sam fri 10am remind me 30m before\`. Phrases it recognizes are removed from the title. Explicit fields such as \`title\` or \`priority\` win over what it parsed.
- \`clients\` says which app created the task (\`created\`) and which wrote to it last (\`edited\`, the creation until anything else changes it), so you know where and how it was captured. Each is \`{ kind, version, device, os, timeZone, at }\`: \`kind\` is \`web\`, \`ios\`, or \`api\` (this API, scripts, and integrations), \`device\` is a model such as \`iPhone17,1\`, a browser such as \`Chrome\`, or an \`api\` caller's \`User-Agent\`, \`timeZone\` is the device's, and \`at\` is when the server took the write, in epoch milliseconds. Unknown parts are \`null\`, and \`created\` or \`edited\` is \`null\` for writes from before the server recorded apps. It is read only and never shown in the apps. \`GET /api/view\` and every route that returns a task include it.

## Comments

- Comments are how you talk with the people on a task. The owner and anyone the task is shared with see them in the apps, with your name and an \`AI\` badge, and unread ones light up on the task's row.
- \`body\` is free text; links in it open in the apps. You may edit or delete only your own comments.

## Projects, sections, and labels

Read them from \`GET /api/view\`. Put a task in one with \`#Project\`, \`/section\`, or \`@label\` in \`text\`, or with \`projectId\`, \`sectionId\`, and \`labelIds\`. A \`#name\` or \`@name\` that matches nothing stays in the task's title, so make the project or label first.

- A project is a list of tasks. Its name is unique, ignoring case. The apps list projects by \`order\`, then \`createdAt\`, and \`index\` moves one to that place from 0. Deleting it deletes its sections and every task in it.
- A section is a heading inside one project. Its name is unique in the project, ignoring case, and \`index\` orders the sections from 0. Deleting it deletes its tasks.
- A label tags tasks across projects. Its name is unique, ignoring case, and its \`color\` is one of \`${LABEL_COLORS.join('`, `')}\`. Deleting it only takes it off its tasks.
- A saved place is a label with a \`place\`: its \`address\`, \`latitude\`, \`longitude\`, and \`radius\` in meters. \`@name\` in \`text\`, or its id in \`labelIds\`, sets the task's \`location\` to it instead of tagging the task. Its tasks are the open tasks at that spot. \`PATCH\` with \`radius\` resizes it, and its open tasks take the new radius. Renaming it renames the place on them. Deleting it leaves the place on its tasks.
- Adding a project, section, or label with a name already taken returns the existing one, so a retry never makes a duplicate.

## Public links

\`POST /api/links\` publishes a task, a project, or a label as a read-only page at its \`url\`. Anyone with the URL sees the target's open and completed tasks, their subtasks, and the projects and labels they use, without signing in. Nobody can edit through a link. Asking again for the same target returns the same link. \`DELETE /api/links?id=\` revokes it at once. The owner sees and revokes the same links in the app's share sheet. Publish only what the owner asked you to share.

## Examples

\`$TOKEN\` is your token and \`${TASK_ID}\` a task id from \`GET /api/view\`.

${examples.join('\n\n')}

## Errors

Errors are JSON \`{ "code", "message" }\`:

- \`400 BAD_REQUEST\`: the input does not match the schema, a title or name is blank, or another project, label, or section in the project already has the name.
- \`401 UNAUTHORIZED\`: the token is missing, wrong, or revoked.
- \`403 FORBIDDEN\`: the route is not open to AI accounts, or the change touches something you may not edit.
- \`404 NOT_FOUND\`: nothing with that id is visible to you.

## Sync

\`POST /api/sync\` is how the apps replicate. Most agents never need it, since \`GET /api/view\` and the task routes cover reading and editing. Send \`{ "cursor": 0, "ops": [] }\` to receive the whole visible snapshot with a \`cursor\` and a \`scope\`. Send that \`scope\` back next time to receive no changes while nothing you can see moved. Each op carries a fresh \`opId\` and a hybrid logical clock \`hlc\`; field-level last-writer-wins resolves conflicts. Task ops are applied when the task is editable before and after, and project, section, and label ops apply too; settings and read-marker ops are acknowledged and dropped.
`;
}

/** What Settings copies for the owner to paste into an AI assistant along with a new token. */
export function agentPrompt(origin: string, token: string): string {
	return `You can read and manage my tasks in ProcrastiMate, my task manager, through its HTTP API. Authenticate every request with the header \`Authorization: Bearer ${token}\`. Start by reading the API guide at ${origin}/api/docs/agent with that header; it lists every route you may call, with examples. Keep the token secret.`;
}

export function agentOpenApiFor(origin: string) {
	return { ...agentOpenApi, servers: [{ url: origin }] };
}
