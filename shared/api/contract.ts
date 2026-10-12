import { oc, type ContractRouterClient } from '@orpc/contract';
import { z } from 'zod';
import { pushScheduleResponseSchema, pushSubscriptionSchema, subscribeRequestSchema } from '../push.ts';
import { syncRequestSchema, syncResponseSchema } from '../sync/protocol.ts';

/**
 * Every HTTP endpoint the clients call, as one oRPC contract. The server implements it, the web client calls it
 * through `ContractRouterClient`, and `scripts/generate` turns it into the OpenAPI document and the Swift types.
 * Better Auth's `/api/auth/*` routes and the two WebSockets are outside it.
 */

const okSchema = z.object({ ok: z.literal(true) });

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

export const pushKeySchema = z.object({ publicKey: z.string() });

/** What the push service answered a test push with, or null when it never answered. */
const pushStatusSchema = z.object({ status: z.number().int().nullable() });

const signedIn = oc.errors({ UNAUTHORIZED: {}, SERVICE_UNAVAILABLE: {} });

/** Served by the Worker itself. */
export const workerContract = {
	status: oc.route({ method: 'GET', path: '/api/status' }).output(okSchema),
	auth: {
		methods: oc.route({ method: 'GET', path: '/api/auth/methods' }).output(authMethodsSchema),
	},
	account: {
		/** Deletes the signed-in user and their tasks. Social accounts have no password, so none is asked for. */
		delete: signedIn.route({ method: 'POST', path: '/api/account/delete' }).output(okSchema),
	},
	push: {
		key: oc.errors({ SERVICE_UNAVAILABLE: {} }).route({ method: 'GET', path: '/api/push/key' }).output(pushKeySchema),
		/** Sends one push to `subscription` right away, for the settings check. */
		test: signedIn
			.errors({
				PUSH_GONE: { status: 410, data: pushStatusSchema },
				PUSH_FAILED: { status: 502, data: pushStatusSchema },
			})
			.route({ method: 'POST', path: '/api/push/test' })
			.input(z.object({ subscription: pushSubscriptionSchema }))
			.output(okSchema),
	},
};

/** Served by the signed-in user's `Account` Durable Object, as the device the request names. */
export const accountContract = {
	sync: signedIn.route({ method: 'POST', path: '/api/sync' }).input(syncRequestSchema).output(syncResponseSchema),
	push: {
		/** Registers this device's subscription. A browser that paired again as a new device replaces its old entry. */
		subscribe: signedIn
			.route({ method: 'PUT', path: '/api/push/subscription' })
			.input(subscribeRequestSchema)
			.output(okSchema),
		unsubscribe: signedIn.route({ method: 'DELETE', path: '/api/push/subscription' }).output(okSchema),
		/** What the server will deliver to this device, soonest first. For inspecting a run, not a user path. */
		schedule: signedIn.route({ method: 'GET', path: '/api/push/schedule' }).output(pushScheduleResponseSchema),
	},
};

/** Worker to `Account` only. The Worker never forwards it, so no client can call it. */
export const internalContract = {
	wipe: oc.errors({ UNAUTHORIZED: {} }).route({ method: 'POST', path: '/api/account/wipe' }).output(okSchema),
};

/** What clients call. */
export const contract = {
	...workerContract,
	...accountContract,
	push: { ...workerContract.push, ...accountContract.push },
};

export type ApiClient = ContractRouterClient<typeof contract>;
