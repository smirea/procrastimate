import { z } from 'zod';

/** The most notifications one device can have scheduled at once. */
export const MAX_SCHEDULED = 500;

export const pushSubscriptionSchema = z.object({
	endpoint: z.url({ protocol: /^https?$/ }),
	keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** A browser push subscription, as `PushSubscription.toJSON()` returns it. */
export type PushSubscriptionInfo = z.infer<typeof pushSubscriptionSchema>;

export const scheduledPushSchema = z.object({
	at: z.number().int().nonnegative(),
	taskId: z.string().min(1).max(100),
	title: z.string().max(300),
	body: z.string().max(200),
});

/** One system notification the server delivers at `at`, in epoch milliseconds. */
export type ScheduledPush = z.infer<typeof scheduledPushSchema>;

/** `PUT /api/push/schedule` replaces everything scheduled for the device that owns `subscription`. */
export const scheduleRequestSchema = z.object({
	subscription: pushSubscriptionSchema,
	notifications: z.array(scheduledPushSchema).max(MAX_SCHEDULED),
});

export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>;

/** The decrypted push payload the service worker shows. Notifications with the same `tag` replace each other. */
export type PushMessage = { title: string; body: string; tag: string; taskId: string | null };

export const pushTag = (push: Pick<ScheduledPush, 'taskId' | 'at'>) => `${push.taskId}:${push.at}`;
