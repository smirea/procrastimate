import { z } from 'zod';
import { pushSubscriptionSchema, type PushMessage, type PushSubscriptionInfo } from '../../shared/push';
import type { SendPush } from './account/push';
import type { Env, Handler } from './bindings';
import { classifyDelivery } from './push-schedule';
import { sendPush, VAPID_SUBJECT, type Vapid } from './web-push';

function vapidKeys(env: Env): Vapid | null {
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
	return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT };
}

/** Push services are https. Loopback http is the end to end suite's fake push service. */
export function isAllowedEndpoint(endpoint: string) {
	const url = new URL(endpoint);
	return url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

async function send(subscription: PushSubscriptionInfo, message: PushMessage, vapid: Vapid, ttl?: number) {
	try {
		const response = await sendPush(subscription, message, vapid, ttl);
		await response.body?.cancel();
		return response.status;
	} catch {
		return null;
	}
}

/** Sends with the Worker's VAPID keys. Without them every send fails like an unreachable push service. */
export function pushSender(env: Env): SendPush {
	return async (subscription, message) => {
		const vapid = vapidKeys(env);
		return vapid ? send(subscription, message, vapid) : null;
	};
}

const testSchema = z.object({
	subscription: pushSubscriptionSchema.refine(subscription => isAllowedEndpoint(subscription.endpoint)),
});

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

function withVapid(handler: (request: Request, vapid: Vapid) => Promise<Response>): Handler {
	return (request, env) => {
		const vapid = vapidKeys(env);
		if (!env.ACCOUNT || !vapid) return fail(503, 'Push notifications are not configured');
		return handler(request, vapid);
	};
}

const TEST_MESSAGE = {
	title: 'Notifications are on',
	body: 'Procrastimate will notify you here when tasks are due.',
	tag: 'test',
	taskId: null,
};

/** The Worker's push routes. Subscriptions and the schedule live in the `Account` object. */
export const pushRoutes: Record<string, Handler> = {
	'GET /api/push/key': withVapid(async (_request, vapid) => Response.json({ publicKey: vapid.publicKey })),

	'POST /api/push/test': withVapid(async (request, vapid) => {
		const body = testSchema.safeParse(await request.json().catch(() => undefined));
		if (!body.success) return fail(400, 'Invalid subscription');
		const status = await send(body.data.subscription, TEST_MESSAGE, vapid, 300);
		if (status !== null && status >= 200 && status < 300) return Response.json({ ok: true });
		return Response.json({ ok: false, status }, { status: classifyDelivery(status) === 'gone' ? 410 : 502 });
	}),
};
