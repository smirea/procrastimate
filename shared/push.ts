import { z } from 'zod';
import { scheduledNotificationSchema, type ScheduledNotification } from './notifications.ts';

/** The most notifications the server keeps pending for one device at once. */
export const MAX_SCHEDULED = 500;

export const pushSubscriptionSchema = z.object({
	endpoint: z.url({ protocol: /^https?$/ }),
	keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** A browser push subscription, as `PushSubscription.toJSON()` returns it. */
export type PushSubscriptionInfo = z.infer<typeof pushSubscriptionSchema>;

/** One system notification the server delivers at `at`, in epoch milliseconds. */
export const scheduledPushSchema = scheduledNotificationSchema;
export type ScheduledPush = ScheduledNotification;

/** `PUT /api/push/subscription` registers the subscription of the device whose token the request carries. */
export const subscribeRequestSchema = z.object({ subscription: pushSubscriptionSchema });

/** The decrypted push payload the service worker shows. Notifications with the same `tag` replace each other. */
export type PushMessage = { title: string; body: string; tag: string; taskId: string | null };

export const pushTag = (push: Pick<ScheduledPush, 'taskId' | 'at'>) => `${push.taskId}:${push.at}`;
