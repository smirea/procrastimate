import { oc, type RouterContractClient } from '@orpc/contract';
import { openapi, type JsonifiedClient } from '@orpc/openapi';
import { z } from 'zod';
import { pushRowSchema } from '../db/generated/zod.ts';
import { memoQuerySchema, memoTasksRequestSchema, memoTasksSchema } from '../memo-tasks.ts';
import { pushSubscriptionSchema, subscribeRequestSchema } from '../push.ts';
import {
	activityEntrySchema,
	agentNewTaskSchema,
	agentTaskSchema,
	apiTokenSchema,
	createdApiTokenSchema,
	labelEditSchema,
	newCommentSchema,
	newLabelSchema,
	newLinkSchema,
	newProjectSchema,
	projectEditSchema,
	newSectionSchema,
	personSchema,
	shareAudienceSchema,
	sharedViewSchema,
	shareTargetSchema,
	shareViewSchema,
	spaceSchema,
	sectionEditSchema,
	spaceViewSchema,
	taskCommentSchema,
} from '../sharing.ts';
import { taskEditSchema } from '../store.ts';
import { imageSizeSchema } from '../images.ts';
import { roleSchema } from '../values.ts';
import {
	labelSchema,
	nudgeSchema,
	projectSchema,
	sectionSchema,
	syncRequestSchema,
	syncResponseSchema,
} from '../sync/protocol.ts';

/**
 * Every HTTP endpoint the clients call, as one oRPC contract. The server implements it, the web client calls it
 * through `ContractRouterClient`, and `scripts/generate` turns it into the OpenAPI document and the Swift types.
 * Better Auth's `/api/auth/*` routes and the two WebSockets are outside it.
 */

export const okSchema = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' });

/** oRPC sends a `File` as its own body, so a bot reading the docs gets plain Markdown instead of a JSON string. */
export const MARKDOWN = 'text/markdown; charset=utf-8';
export const JSON_UTF8 = 'application/json; charset=utf-8';
const markdownSchema = z.file().mime(MARKDOWN);

/** Which sign-in buttons the server can offer. Empty credentials hide a provider, so CI boots without them. */
export const authMethodsSchema = z
	.object({
		email: z.boolean(),
		/** Web redirect. The iOS client id alone does not turn this on. */
		google: z.boolean(),
		/** Web redirect through the Services ID. */
		apple: z.boolean(),
		/** Public iOS client id, or null when Google sign-in on the phone is off. */
		googleIosClientId: z.string().nullable(),
		/** Native Sign in with Apple, whose audience is the bundle id. */
		appleNative: z.boolean(),
	})
	.meta({ id: 'AuthMethods' });
export type AuthMethods = z.infer<typeof authMethodsSchema>;

export const pushScheduleResponseSchema = pushRowSchema.pick({ notifications: true }).meta({ id: 'PushSchedule' });
export type PushScheduleResponse = z.infer<typeof pushScheduleResponseSchema>;

export const pushKeySchema = z.object({ publicKey: z.string() }).meta({ id: 'PushKey' });

/** What the push service answered a test push with, or null when it never answered. */
const pushStatusSchema = z.object({ status: z.number().int().nullable() });

const signedIn = oc.errors({ UNAUTHORIZED: {}, SERVICE_UNAVAILABLE: {} });
/** `FORBIDDEN` when the caller may not reach the space, or is an AI account on a human-only route. */
const allowed = signedIn.errors({ FORBIDDEN: {} });
const found = allowed.errors({ NOT_FOUND: {} });

/** Which space a request is for, by its owner's id. Without it, the caller's own (an AI account's owner's). */
const spaceQuery = z.object({ space: z.string().optional() });
const byId = z.object({ id: z.string() });
const taskQuery = spaceQuery.extend(byId.shape);

export const peopleSchema = z.object({ people: z.array(personSchema) }).meta({ id: 'People' });
export const aiAccountsSchema = z.object({ accounts: z.array(personSchema) }).meta({ id: 'AiAccounts' });
export const spacesSchema = z.object({ spaces: z.array(spaceSchema) }).meta({ id: 'Spaces' });
export const sharesSchema = z.object({ shares: z.array(shareViewSchema) }).meta({ id: 'Shares' });
export const newShareSchema = z
	.object({ target: shareTargetSchema, audience: shareAudienceSchema })
	.meta({ id: 'NewShare' });
export const apiTokensSchema = z.object({ tokens: z.array(apiTokenSchema) }).meta({ id: 'ApiTokens' });
export const newApiTokenSchema = z
	.object({ aiUserId: apiTokenSchema.shape.aiUserId, name: apiTokenSchema.shape.name })
	.meta({ id: 'NewApiToken' });
export const taskCommentsSchema = z.object({ comments: z.array(taskCommentSchema) }).meta({ id: 'TaskComments' });
export const activitySchema = z.object({ entries: z.array(activityEntrySchema) }).meta({ id: 'Activity' });
export const linksSchema = z.object({ links: z.array(shareViewSchema) }).meta({ id: 'Links' });

export const workerContract = {
	status: oc.meta(openapi({ method: 'GET', path: '/api/status' })).output(okSchema),
	auth: {
		methods: oc.meta(openapi({ method: 'GET', path: '/api/auth/methods' })).output(authMethodsSchema),
	},
	account: {
		/** Deletes the signed-in user and their tasks. Social accounts have no password, so none is asked for. */
		delete: signedIn.meta(openapi({ method: 'POST', path: '/api/account/delete' })).output(okSchema),
	},
	push: {
		key: oc
			.errors({ SERVICE_UNAVAILABLE: {} })
			.meta(openapi({ method: 'GET', path: '/api/push/key' }))
			.output(pushKeySchema),
		test: signedIn
			.errors({
				GONE: { data: pushStatusSchema },
				BAD_GATEWAY: { data: pushStatusSchema },
			})
			.meta(openapi({ method: 'POST', path: '/api/push/test' }))
			.input(z.object({ subscription: pushSubscriptionSchema }))
			.output(okSchema),
	},
	people: {
		/**
		 * An exact email match over every user, plus the caller's AI accounts and the people its space has met,
		 * matched on a name prefix. There is no prefix search over every user, so nobody can list them.
		 */
		search: signedIn
			.meta(openapi({ method: 'GET', path: '/api/people', inputStructure: 'detailed' }))
			.input(z.object({ query: z.object({ q: z.string() }) }))
			.output(peopleSchema),
	},
	me: signedIn.meta(openapi({ method: 'GET', path: '/api/me' })).output(personSchema),
	/** The signed-in human's AI accounts. */
	ai: {
		list: allowed.meta(openapi({ method: 'GET', path: '/api/ai' })).output(aiAccountsSchema),
		/** Also shares the owner's whole space with it, to edit. */
		create: allowed
			.meta(openapi({ method: 'POST', path: '/api/ai' }))
			.input(z.object({ name: personSchema.shape.name }))
			.output(personSchema),
		/** Deletes the account, its tokens, and its share. */
		delete: found
			.meta(openapi({ method: 'DELETE', path: '/api/ai', inputStructure: 'detailed' }))
			.input(z.object({ query: byId }))
			.output(okSchema),
	},
	shared: {
		/** What a public link shows. Needs no session; the token names the owner. */
		view: oc
			.errors({ NOT_FOUND: {}, SERVICE_UNAVAILABLE: {} })
			.meta(openapi({ method: 'GET', path: '/api/shared', inputStructure: 'detailed' }))
			.input(z.object({ query: z.object({ token: z.string() }) }))
			.output(sharedViewSchema),
	},
	shares: {
		/**
		 * Shares the caller's own space. The Worker serves it because a user audience needs the grantee's name from
		 * Better Auth; the share itself lands in the owner's object, which also writes the guest's membership.
		 */
		create: found
			.meta(openapi({ method: 'POST', path: '/api/shares' }))
			.input(newShareSchema)
			.output(shareViewSchema),
	},
	/** Smoke tests for Sentry: each throws, so a 500 and an event in `procrastimate-worker` prove the path. */
	debug: {
		error: signedIn.meta(openapi({ method: 'POST', path: '/api/debug/error' })).output(okSchema),
	},
	/** Docs for AI agents, generated from `agentContract`. The entry point needs no token; the reference does. */
	docs: {
		start: oc
			.meta(openapi({ method: 'GET', path: '/api/docs', summary: 'What ProcrastiMate is and how an agent gets in' }))
			.output(markdownSchema),
		agent: signedIn
			.meta(openapi({ method: 'GET', path: '/api/docs/agent', summary: 'The guide to every route the caller may use' }))
			.output(markdownSchema),
		openapi: signedIn
			.meta(openapi({ method: 'GET', path: '/api/docs/openapi', summary: 'The OpenAPI subset the caller may use' }))
			.output(z.file().mime(JSON_UTF8)),
	},
};

/**
 * What an AI account, or a guest of a space, may call: sync, view, the task, project, section, label, and link commands,
 * comments, and activity. Projects, sections, labels, and links are only the owner's and an AI account's, which holds
 * a whole-space edit share. Everything else is the human owner's. The agent docs and their OpenAPI subset are generated from it, so each `summary` and
 * `description` here is what an agent reads.
 */
export const agentContract = {
	sync: allowed
		.meta(
			openapi({
				method: 'POST',
				path: '/api/sync',
				inputStructure: 'detailed',
				summary: 'Sync the space',
				description:
					'The apps’ replication protocol. `{ "cursor": 0, "ops": [] }` answers with the whole visible snapshot. A task op is applied when the task is editable before and after it, a comment op when its task is editable and the comment is new or the caller’s own, and a project, section, or label op only for the owner or an AI account; other ops are acknowledged and dropped. Each op is validated on its own: one that fails is listed in `rejected` with the reason and never applies, the rest still do, and the answer is the whole snapshot.',
			}),
		)
		.input(z.object({ query: spaceQuery, body: syncRequestSchema }))
		.output(syncResponseSchema),
	view: allowed
		.meta(
			openapi({
				method: 'GET',
				path: '/api/view',
				inputStructure: 'detailed',
				summary: 'Everything the caller sees',
				description:
					'The tasks, projects, and labels of the space, and the ids of visible tasks the caller may not edit.',
			}),
		)
		.input(z.object({ query: spaceQuery }))
		.output(spaceViewSchema),
	tasks: {
		create: found
			.meta(
				openapi({
					method: 'POST',
					path: '/api/tasks',
					inputStructure: 'detailed',
					summary: 'Add a task',
					description:
						'`text` reads like the app’s quick add: dates, repeats, `p1` to `p4`, reminders, and `#Project` and `@label` for ones that exist. Explicit fields win over parsed ones.',
				}),
			)
			.input(z.object({ query: spaceQuery, body: agentNewTaskSchema }))
			.output(agentTaskSchema),
		update: found
			.meta(
				openapi({
					method: 'PATCH',
					path: '/api/tasks',
					inputStructure: 'detailed',
					summary: 'Edit a task',
					description: 'Only the fields sent change; `null` clears a nullable field.',
				}),
			)
			.input(z.object({ query: taskQuery, body: taskEditSchema }))
			.output(agentTaskSchema),
		complete: found
			.meta(
				openapi({
					method: 'POST',
					path: '/api/tasks/complete',
					inputStructure: 'detailed',
					summary: 'Complete a task',
					description: 'A recurring task moves to its next date instead of closing.',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(agentTaskSchema),
		reopen: found
			.meta(
				openapi({
					method: 'POST',
					path: '/api/tasks/reopen',
					inputStructure: 'detailed',
					summary: 'Reopen a completed task',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(agentTaskSchema),
		delete: found
			.meta(
				openapi({
					method: 'DELETE',
					path: '/api/tasks',
					inputStructure: 'detailed',
					summary: 'Delete a task and its subtasks',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(okSchema),
	},
	activity: {
		list: found
			.meta(
				openapi({
					method: 'GET',
					path: '/api/activity',
					inputStructure: 'detailed',
					summary: 'A task’s history',
					description: 'Who created, edited, completed, reopened, or deleted the task, and when, oldest first.',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(activitySchema),
	},
	comments: {
		list: found
			.meta(
				openapi({
					method: 'GET',
					path: '/api/comments',
					inputStructure: 'detailed',
					summary: 'A task’s comments',
					description: '`id` is the task’s. Oldest first, each with its author.',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(taskCommentsSchema),
		create: found
			.meta(
				openapi({
					method: 'POST',
					path: '/api/comments',
					inputStructure: 'detailed',
					summary: 'Comment on a task',
					description: 'Needs the task editable. Links in `body` show as links in the apps. The caller is the author.',
				}),
			)
			.input(z.object({ query: spaceQuery, body: newCommentSchema }))
			.output(taskCommentSchema),
		update: found
			.meta(
				openapi({
					method: 'PATCH',
					path: '/api/comments',
					inputStructure: 'detailed',
					summary: 'Edit your comment',
					description: '`id` is the comment’s. Only its author may edit it.',
				}),
			)
			.input(z.object({ query: taskQuery, body: newCommentSchema.pick({ body: true }) }))
			.output(taskCommentSchema),
		delete: found
			.meta(
				openapi({
					method: 'DELETE',
					path: '/api/comments',
					inputStructure: 'detailed',
					summary: 'Delete your comment',
					description: '`id` is the comment’s. Only its author may delete it.',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(okSchema),
	},
	projects: {
		create: found
			.meta(
				openapi({
					method: 'POST',
					path: '/api/projects',
					inputStructure: 'detailed',
					summary: 'Add a project',
					description: 'A name already taken, ignoring case, returns that project.',
				}),
			)
			.input(z.object({ query: spaceQuery, body: newProjectSchema }))
			.output(projectSchema),
		update: found
			.meta(
				openapi({
					method: 'PATCH',
					path: '/api/projects',
					inputStructure: 'detailed',
					summary: 'Rename or move a project',
					description:
						'`id` is the project’s. Another project’s name, ignoring case, is refused. `index` is its new place among the projects, from 0.',
				}),
			)
			.input(z.object({ query: taskQuery, body: projectEditSchema }))
			.output(projectSchema),
		delete: found
			.meta(
				openapi({
					method: 'DELETE',
					path: '/api/projects',
					inputStructure: 'detailed',
					summary: 'Delete a project with its sections and tasks',
					description: '`id` is the project’s. Every task in it goes too, subtasks included.',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(okSchema),
	},
	sections: {
		create: found
			.meta(
				openapi({
					method: 'POST',
					path: '/api/sections',
					inputStructure: 'detailed',
					summary: 'Add a section to a project',
					description:
						'It goes last in the project. A name the project already has, ignoring case, returns that section.',
				}),
			)
			.input(z.object({ query: spaceQuery, body: newSectionSchema }))
			.output(sectionSchema),
		update: found
			.meta(
				openapi({
					method: 'PATCH',
					path: '/api/sections',
					inputStructure: 'detailed',
					summary: 'Rename or move a section',
					description: '`id` is the section’s. `index` is its new place among the project’s sections, from 0.',
				}),
			)
			.input(z.object({ query: taskQuery, body: sectionEditSchema }))
			.output(sectionSchema),
		delete: found
			.meta(
				openapi({
					method: 'DELETE',
					path: '/api/sections',
					inputStructure: 'detailed',
					summary: 'Delete a section with its tasks',
					description: '`id` is the section’s. Every task in it goes too, subtasks included.',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(okSchema),
	},
	labels: {
		create: found
			.meta(
				openapi({
					method: 'POST',
					path: '/api/labels',
					inputStructure: 'detailed',
					summary: 'Add a label',
					description:
						'A name already taken, ignoring case, returns that label. Without `color` it gets the app’s default for the name.',
				}),
			)
			.input(z.object({ query: spaceQuery, body: newLabelSchema }))
			.output(labelSchema),
		update: found
			.meta(
				openapi({
					method: 'PATCH',
					path: '/api/labels',
					inputStructure: 'detailed',
					summary: 'Rename or recolor a label',
					description: '`id` is the label’s.',
				}),
			)
			.input(z.object({ query: taskQuery, body: labelEditSchema }))
			.output(labelSchema),
		delete: found
			.meta(
				openapi({
					method: 'DELETE',
					path: '/api/labels',
					inputStructure: 'detailed',
					summary: 'Delete a label',
					description: '`id` is the label’s. Its tasks stay and only lose the label.',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(okSchema),
	},
	links: {
		list: found
			.meta(
				openapi({
					method: 'GET',
					path: '/api/links',
					inputStructure: 'detailed',
					summary: 'The space’s public links',
					description: 'Every read-only link the owner or an AI account made, with its `url`.',
				}),
			)
			.input(z.object({ query: spaceQuery }))
			.output(linksSchema),
		create: found
			.meta(
				openapi({
					method: 'POST',
					path: '/api/links',
					inputStructure: 'detailed',
					summary: 'Publish a task, project, or label as a read-only link',
					description:
						'Anyone with `url` sees the target, its subtasks, and their projects and labels, without signing in, until the link is deleted. Asking again for the same target returns the same link.',
				}),
			)
			.input(z.object({ query: spaceQuery, body: newLinkSchema }))
			.output(shareViewSchema),
		delete: found
			.meta(
				openapi({
					method: 'DELETE',
					path: '/api/links',
					inputStructure: 'detailed',
					summary: 'Delete a public link',
					description: '`id` is the link’s. Its `url` stops working at once.',
				}),
			)
			.input(z.object({ query: taskQuery }))
			.output(okSchema),
	},
	/**
	 * The `Account` object answers it before its router, so the owner's reads skip the space's queue. Uploading,
	 * `PUT /api/images`, stays outside the contract: its body is raw bytes, and AI accounts do not upload.
	 */
	images: {
		get: found
			.meta(
				openapi({
					method: 'GET',
					path: '/api/images',
					inputStructure: 'detailed',
					summary: 'An image on a task',
					description:
						'`id` is an image id from a task’s `images`, and `size` is `full` (at most 2048 px on its long side) or `thumb` (320 px). Answers the JPEG or WebP bytes. An image is visible when a task you can see lists it.',
				}),
			)
			.input(z.object({ query: spaceQuery.extend({ id: z.string(), size: imageSizeSchema }) }))
			.output(z.file()),
	},
};

/**
 * Served by a space's `Account` Durable Object: the caller's own unless `?space=` names one shared with them. The
 * Worker routes on that query alone and forwards the body unread.
 */
export const accountContract = {
	...agentContract,
	spaces: {
		/** The spaces shared with the caller. Served by the caller's own object. */
		list: signedIn.meta(openapi({ method: 'GET', path: '/api/spaces' })).output(spacesSchema),
	},
	/** The owner's shares of their own space. Human owners only. */
	shares: {
		list: allowed.meta(openapi({ method: 'GET', path: '/api/shares' })).output(sharesSchema),
		delete: found
			.meta(openapi({ method: 'DELETE', path: '/api/shares', inputStructure: 'detailed' }))
			.input(z.object({ query: byId }))
			.output(okSchema),
	},
	/** API tokens for the owner's AI accounts. Human owners only. */
	tokens: {
		list: allowed.meta(openapi({ method: 'GET', path: '/api/ai-tokens' })).output(apiTokensSchema),
		/** The only response that carries the secret. */
		create: found
			.meta(openapi({ method: 'POST', path: '/api/ai-tokens' }))
			.input(newApiTokenSchema)
			.output(createdApiTokenSchema),
		delete: found
			.meta(openapi({ method: 'DELETE', path: '/api/ai-tokens', inputStructure: 'detailed' }))
			.input(z.object({ query: byId }))
			.output(okSchema),
	},
	push: {
		/** Registers this device's subscription. A browser that paired again as a new device replaces its old entry. */
		subscribe: signedIn
			.meta(openapi({ method: 'PUT', path: '/api/push/subscription' }))
			.input(subscribeRequestSchema)
			.output(okSchema),
		unsubscribe: signedIn.meta(openapi({ method: 'DELETE', path: '/api/push/subscription' })).output(okSchema),
		/** What the server will deliver to this device, soonest first. For inspecting a run, not a user path. */
		schedule: signedIn.meta(openapi({ method: 'GET', path: '/api/push/schedule' })).output(pushScheduleResponseSchema),
	},
	/** Throws inside the space's `Account` object, so its event lands in the caller's trace. */
	debug: {
		accountError: signedIn.meta(openapi({ method: 'POST', path: '/api/debug/account-error' })).output(okSchema),
	},
	/** Notouroboros's tasks. See `docs/decisions/integrations.md`. */
	memoTasks: {
		list: signedIn
			.meta(openapi({ method: 'GET', path: '/api/memo-tasks', inputStructure: 'detailed' }))
			.input(memoQuerySchema)
			.output(memoTasksSchema),
		/** Adds the tasks whose keys the account has never seen, live or deleted, to the Inbox. */
		put: signedIn
			.meta(openapi({ method: 'PUT', path: '/api/memo-tasks' }))
			.input(memoTasksRequestSchema)
			.output(memoTasksSchema),
		/** Deletes the memo's live tasks and their subtasks. */
		delete: signedIn
			.meta(openapi({ method: 'DELETE', path: '/api/memo-tasks', inputStructure: 'detailed' }))
			.input(memoQuerySchema)
			.output(okSchema),
	},
};

/** Worker to `Account` only. The Worker never forwards it, so no client can call it. */
export const internalContract = {
	wipe: oc
		.errors({ UNAUTHORIZED: {} })
		.meta(openapi({ method: 'POST', path: '/api/account/wipe' }))
		.output(okSchema),
	/** Owner to guest: the owner's space is shared with this user (`live`), or no longer is. */
	membership: oc
		.errors({ UNAUTHORIZED: {} })
		.meta(openapi({ method: 'POST', path: '/api/account/membership' }))
		.input(z.object({ spaceId: z.string(), owner: personSchema, live: z.boolean() }))
		.output(okSchema),
	/** Owner to guest: `space` moved to `cursor`, which the guest's sockets hear as is. Skips the serial queue. */
	nudge: oc
		.errors({ UNAUTHORIZED: {} })
		.meta(openapi({ method: 'POST', path: '/api/account/nudge' }))
		.input(nudgeSchema.required({ space: true }))
		.output(okSchema),
	/** Worker to owner: a share the Worker resolved the grantee of. `grantee` is null for a link. */
	share: oc
		.errors({ NOT_FOUND: {} })
		.meta(openapi({ method: 'POST', path: '/api/account/share' }))
		.input(z.object({ target: shareTargetSchema, grantee: personSchema.nullable(), role: roleSchema }))
		.output(shareViewSchema),
	/** Worker to owner: an AI account was deleted, so its tokens, shares, and people row go. */
	revokeAi: oc
		.meta(openapi({ method: 'POST', path: '/api/account/revoke-ai' }))
		.input(z.object({ aiUserId: z.string() }))
		.output(okSchema),
	/** Worker to owner: everyone the space has met, for people search. */
	people: oc.meta(openapi({ method: 'POST', path: '/api/account/people' })).output(peopleSchema),
	/** Worker to owner: what the link share `id` shows, for anyone holding its token. */
	sharedView: oc
		.errors({ NOT_FOUND: {} })
		.meta(openapi({ method: 'POST', path: '/api/account/shared-view' }))
		.input(byId)
		.output(sharedViewSchema),
	/** Worker to owner: the AI account a `pm.<ownerId>.<secret>` token belongs to, or null. */
	resolveToken: oc
		.errors({ UNAUTHORIZED: {} })
		.meta(openapi({ method: 'POST', path: '/api/account/resolve-token' }))
		.input(z.object({ secret: z.string() }))
		.output(z.object({ aiUserId: z.string().nullable() })),
};

export const contract = {
	...workerContract,
	...accountContract,
	push: { ...workerContract.push, ...accountContract.push },
	shares: { ...workerContract.shares, ...accountContract.shares },
	debug: { ...workerContract.debug, ...accountContract.debug },
};

/** OpenAPI carries JSON, so the client's types are the contract's jsonified. */
export type ApiClient = JsonifiedClient<RouterContractClient<typeof contract>>;
