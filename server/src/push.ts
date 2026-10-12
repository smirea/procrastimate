import { ORPCError } from '@orpc/server';
import type { PushMessage, PushSubscriptionInfo } from '../../shared/push';
import type { SendPush } from './account/push';
import type { Env } from './bindings';
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

const TEST_MESSAGE = {
	title: 'Notifications are on',
	body: 'Procrastimate will notify you here when tasks are due.',
	tag: 'test',
	taskId: null,
};

/** The Worker's VAPID keys. Without them push is off. */
export function requireVapid(env: Env): Vapid {
	const vapid = vapidKeys(env);
	if (!env.ACCOUNT || !vapid)
		throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Push notifications are not configured' });
	return vapid;
}

/** Sends the settings check push and returns the push service's status, or null when it never answered. */
export function sendTestPush(subscription: PushSubscriptionInfo, vapid: Vapid): Promise<number | null> {
	if (!isAllowedEndpoint(subscription.endpoint))
		throw new ORPCError('BAD_REQUEST', { message: 'Invalid subscription' });
	return send(subscription, TEST_MESSAGE, vapid, 300);
}
