import { oc, type RouterContractClient } from '@orpc/contract';
import { openapi, type JsonifiedClient } from '@orpc/openapi';
import { z } from 'zod';
import { pushRowSchema } from '../db/generated/zod.ts';
import { memoQuerySchema, memoTasksRequestSchema, memoTasksSchema } from '../memo-tasks.ts';
import { pushSubscriptionSchema, subscribeRequestSchema } from '../push.ts';
import {
	activityEntrySchema,
	agentNewTaskSchema,
	apiTokenSchema,
	createdApiTokenSchema,
	personSchema,
	shareAudienceSchema,
	sharedViewSchema,
	shareTargetSchema,
	shareViewSchema,
	spaceSchema,
	spaceViewSchema,
} from '../sharing.ts';
import { taskEditSchema } from '../store.ts';
import { roleSchema } from '../values.ts';
import { nudgeSchema, syncRequestSchema, syncResponseSchema, taskSchema } from '../sync/protocol.ts';

/**
 * Every HTTP endpoint the clients call, as one oRPC contract. The server implements it, the web client calls it
 * through `ContractRouterClient`, and `scripts/generate` turns it into the OpenAPI document and the Swift types.
 * Better Auth's `/api/auth/*` routes and the two WebSockets are outside it.
 */

export const okSchema = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' });

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
export const activitySchema = z.object({ entries: z.array(activityEntrySchema) }).meta({ id: 'Activity' });

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
};

/**
 * Served by a space's `Account` Durable Object: the caller's own unless `?space=` names one shared with them. The
 * Worker routes on that query alone and forwards the body unread.
 */
export const accountContract = {
	sync: allowed
		.meta(openapi({ method: 'POST', path: '/api/sync', inputStructure: 'detailed' }))
		.input(z.object({ query: spaceQuery, body: syncRequestSchema }))
		.output(syncResponseSchema),
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
	activity: {
		/** One task's history from the space's log, oldest first. */
		list: found
			.meta(openapi({ method: 'GET', path: '/api/activity', inputStructure: 'detailed' }))
			.input(z.object({ query: taskQuery }))
			.output(activitySchema),
	},
	/** The agent command API: the store's rules run on the server, for anyone who may edit the space. */
	view: allowed
		.meta(openapi({ method: 'GET', path: '/api/view', inputStructure: 'detailed' }))
		.input(z.object({ query: spaceQuery }))
		.output(spaceViewSchema),
	tasks: {
		create: found
			.meta(openapi({ method: 'POST', path: '/api/tasks', inputStructure: 'detailed' }))
			.input(z.object({ query: spaceQuery, body: agentNewTaskSchema }))
			.output(taskSchema),
		update: found
			.meta(openapi({ method: 'PATCH', path: '/api/tasks', inputStructure: 'detailed' }))
			.input(z.object({ query: taskQuery, body: taskEditSchema }))
			.output(taskSchema),
		complete: found
			.meta(openapi({ method: 'POST', path: '/api/tasks/complete', inputStructure: 'detailed' }))
			.input(z.object({ query: taskQuery }))
			.output(taskSchema),
		reopen: found
			.meta(openapi({ method: 'POST', path: '/api/tasks/reopen', inputStructure: 'detailed' }))
			.input(z.object({ query: taskQuery }))
			.output(taskSchema),
		delete: found
			.meta(openapi({ method: 'DELETE', path: '/api/tasks', inputStructure: 'detailed' }))
			.input(z.object({ query: taskQuery }))
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
};

/** OpenAPI carries JSON, so the client's types are the contract's jsonified. */
export type ApiClient = JsonifiedClient<RouterContractClient<typeof contract>>;
