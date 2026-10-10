import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';
import {
	pushSubscriptionSchema,
	pushTag,
	scheduleRequestSchema,
	type PushSubscriptionInfo,
	type ScheduledPush,
	type ScheduleRequest,
} from '../../shared/push';
import { classifyDelivery, isRetryable, nextAlarm, planSchedule, splitDue, type Delivery } from './push-schedule';
import type { Env, Handler } from './bindings';
import { sendPush, VAPID_SUBJECT, type Vapid } from './web-push';

type Push = { schedules: DurableObjectNamespace; vapid: Vapid };

function vapidKeys(env: Env): Vapid | null {
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
	return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT };
}

/** One Durable Object per push subscription stores its schedule and wakes on an alarm to deliver it. */
export class PushSchedule {
	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: Env,
	) {}

	async fetch(request: Request): Promise<Response> {
		const storage = this.ctx.storage;
		switch (request.method) {
			case 'PUT': {
				const { subscription, notifications: incoming } = (await request.json()) as ScheduleRequest;
				const deliveredThrough = (await storage.get<number>('deliveredThrough')) ?? 0;
				const stored = (await storage.get<ScheduledPush[]>('notifications')) ?? [];
				const notifications = planSchedule(incoming, stored, deliveredThrough, Date.now());
				await storage.put({ subscription, notifications });
				await this.syncAlarm(notifications);
				return Response.json({ scheduled: notifications.length });
			}
			case 'GET':
				return Response.json({ notifications: (await storage.get<ScheduledPush[]>('notifications')) ?? [] });
			case 'DELETE':
				await this.clear();
				return Response.json({ ok: true });
			default:
				return new Response(null, { status: 405 });
		}
	}

	async alarm(): Promise<void> {
		const storage = this.ctx.storage;
		const now = Date.now();
		const subscription = await storage.get<PushSubscriptionInfo>('subscription');
		const { due } = splitDue((await storage.get<ScheduledPush[]>('notifications')) ?? [], now);
		const settled = new Set<string>();
		for (const push of due) {
			const delivery = subscription ? await this.deliver(subscription, push) : 'gone';
			if (delivery === 'gone') return this.clear();
			if (delivery === 'sent' || !isRetryable(push, now)) settled.add(pushTag(push));
		}
		// A PUT can land while sends are in flight, so filter what is stored now rather than the list read above.
		const remaining = ((await storage.get<ScheduledPush[]>('notifications')) ?? []).filter(
			push => !settled.has(pushTag(push)),
		);
		await storage.put({ notifications: remaining, deliveredThrough: now });
		await this.syncAlarm(remaining);
	}

	private async deliver(subscription: PushSubscriptionInfo, push: ScheduledPush): Promise<Delivery> {
		const vapid = vapidKeys(this.env);
		if (!vapid) return 'retry';
		try {
			const message = { title: push.title, body: push.body, tag: pushTag(push), taskId: push.taskId };
			const response = await sendPush(subscription, message, vapid);
			await response.body?.cancel();
			return classifyDelivery(response.status);
		} catch {
			return classifyDelivery(null);
		}
	}

	private async syncAlarm(notifications: ScheduledPush[]) {
		const at = nextAlarm(notifications, Date.now());
		await (at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at));
	}

	private async clear() {
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}
}

/** Push services are https. Loopback http is the end to end suite's fake push service. */
function isAllowedEndpoint(endpoint: string) {
	const url = new URL(endpoint);
	return url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

const endpointSchema = z.url().refine(isAllowedEndpoint);
const subscriptionSchema = pushSubscriptionSchema.refine(subscription => isAllowedEndpoint(subscription.endpoint));
const bodySchemas = {
	schedule: scheduleRequestSchema.refine(request => isAllowedEndpoint(request.subscription.endpoint)),
	unschedule: z.object({ endpoint: endpointSchema }),
	test: z.object({ subscription: subscriptionSchema }),
};

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	const parsed = schema.safeParse(await request.json().catch(() => undefined));
	return parsed.success ? parsed.data : null;
}

function withPush(handler: (request: Request, push: Push) => Promise<Response>): Handler {
	return (request, env) => {
		const vapid = vapidKeys(env);
		if (!env.PUSH || !vapid) return fail(503, 'Push notifications are not configured');
		return handler(request, { schedules: env.PUSH, vapid });
	};
}

async function callSchedule<T>(push: Push, endpoint: string, method: string, body?: unknown): Promise<T> {
	const stub = push.schedules.get(push.schedules.idFromName(endpoint));
	const init = { method, body: body === undefined ? undefined : JSON.stringify(body) };
	return (await stub.fetch('https://push/schedule', init)).json<T>();
}

const TEST_MESSAGE = {
	title: 'Notifications are on',
	body: 'Procrastimate will notify you here when tasks are due.',
	tag: 'test',
	taskId: null,
};

export const pushRoutes: Record<string, Handler> = {
	'GET /api/push/key': withPush(async (_request, push) => Response.json({ publicKey: push.vapid.publicKey })),

	'PUT /api/push/schedule': withPush(async (request, push) => {
		const schedule = await parseBody(request, bodySchemas.schedule);
		if (!schedule) return fail(400, 'Invalid schedule');
		const { scheduled } = await callSchedule<{ scheduled: number }>(
			push,
			schedule.subscription.endpoint,
			'PUT',
			schedule,
		);
		return Response.json({ ok: true, scheduled });
	}),

	'GET /api/push/schedule': withPush(async (request, push) => {
		const endpoint = endpointSchema.safeParse(new URL(request.url).searchParams.get('endpoint'));
		if (!endpoint.success) return fail(400, 'Invalid endpoint');
		const { notifications } = await callSchedule<{ notifications: ScheduledPush[] }>(push, endpoint.data, 'GET');
		return Response.json({ notifications });
	}),

	'DELETE /api/push/schedule': withPush(async (request, push) => {
		const body = await parseBody(request, bodySchemas.unschedule);
		if (!body) return fail(400, 'Invalid endpoint');
		await callSchedule(push, body.endpoint, 'DELETE');
		return Response.json({ ok: true });
	}),

	'POST /api/push/test': withPush(async (request, push) => {
		const body = await parseBody(request, bodySchemas.test);
		if (!body) return fail(400, 'Invalid subscription');
		const status = await sendPush(body.subscription, TEST_MESSAGE, push.vapid, 300).then(
			async response => {
				await response.body?.cancel();
				return response.status;
			},
			() => null,
		);
		if (status !== null && status >= 200 && status < 300) return Response.json({ ok: true });
		return Response.json({ ok: false, status }, { status: classifyDelivery(status) === 'gone' ? 410 : 502 });
	}),
};
