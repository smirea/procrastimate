import { oc, type RouterContractClient } from '@orpc/contract';
import { openapi, type JsonifiedClient } from '@orpc/openapi';
import { z } from 'zod';
import { pushRowSchema } from '../db/generated/zod.ts';
import { pushSubscriptionSchema, subscribeRequestSchema } from '../push.ts';
import { syncRequestSchema, syncResponseSchema } from '../sync/protocol.ts';

/**
 * Every HTTP endpoint the clients call, as one oRPC contract. The server implements it, the web client calls it
 * through `ContractRouterClient`, and `scripts/generate` turns it into the OpenAPI document and the Swift types.
 * Better Auth's `/api/auth/*` routes and the two WebSockets are outside it.
 */

export const okSchema = z.object({ ok: z.literal(true) });

/** Which sign-in buttons the server can offer. Empty credentials hide a provider, so CI boots without them. */
export const authMethodsSchema = z.object({
	email: z.boolean(),
	/** Web redirect. The iOS client id alone does not turn this on. */
	google: z.boolean(),
	/** Web redirect through the Services ID. */
	apple: z.boolean(),
	/** Public iOS client id, or null when Google sign-in on the phone is off. */
	googleIosClientId: z.string().nullable(),
	/** Native Sign in with Apple, whose audience is the bundle id. */
	appleNative: z.boolean(),
});
export type AuthMethods = z.infer<typeof authMethodsSchema>;

/** What the server will deliver to the calling device, soonest first: its push row's pending notifications. */
export const pushScheduleResponseSchema = pushRowSchema.pick({ notifications: true });
export type PushScheduleResponse = z.infer<typeof pushScheduleResponseSchema>;

export const pushKeySchema = z.object({ publicKey: z.string() });

/** What the push service answered a test push with, or null when it never answered. */
const pushStatusSchema = z.object({ status: z.number().int().nullable() });

const signedIn = oc.errors({ UNAUTHORIZED: {}, SERVICE_UNAVAILABLE: {} });

/** Served by the Worker itself. */
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
		/** Sends one push to `subscription` right away, for the settings check. */
		test: signedIn
			.errors({
				GONE: { data: pushStatusSchema },
				BAD_GATEWAY: { data: pushStatusSchema },
			})
			.meta(openapi({ method: 'POST', path: '/api/push/test' }))
			.input(z.object({ subscription: pushSubscriptionSchema }))
			.output(okSchema),
	},
};

/** Served by the signed-in user's `Account` Durable Object, as the device the request names. */
export const accountContract = {
	sync: signedIn
		.meta(openapi({ method: 'POST', path: '/api/sync' }))
		.input(syncRequestSchema)
		.output(syncResponseSchema),
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
};

/** Worker to `Account` only. The Worker never forwards it, so no client can call it. */
export const internalContract = {
	wipe: oc
		.errors({ UNAUTHORIZED: {} })
		.meta(openapi({ method: 'POST', path: '/api/account/wipe' }))
		.output(okSchema),
};

/** What clients call. */
export const contract = {
	...workerContract,
	...accountContract,
	push: { ...workerContract.push, ...accountContract.push },
};

/** OpenAPI carries JSON, so the client's types are the contract's jsonified. */
export type ApiClient = JsonifiedClient<RouterContractClient<typeof contract>>;
