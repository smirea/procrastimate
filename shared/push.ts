import { z } from 'zod';
import type { NotificationTarget, ScheduledNotification } from './notifications.ts';

export const MAX_SCHEDULED = 500;

export const pushSubscriptionSchema = z
	.object({
		endpoint: z.url({ protocol: /^https?$/ }),
		keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
	})
	.meta({ id: 'PushSubscription' });

/** A browser push subscription, as `PushSubscription.toJSON()` returns it. */
export type PushSubscriptionInfo = z.infer<typeof pushSubscriptionSchema>;

export const subscribeRequestSchema = z.object({ subscription: pushSubscriptionSchema });

/** The decrypted push payload the service worker shows. Notifications with the same `tag` replace each other. */
export type PushMessage = { title: string; body: string; tag: string; opens: NotificationTarget | null };

/** One notification per moment, so its tag is the moment. */
export const pushTag = (push: Pick<ScheduledNotification, 'at'>) => `at:${push.at}`;

/** Where a tapped notification opens the web app. A task opens its details over Inbox. */
export function notificationHref(opens: NotificationTarget | null): string {
	if (!opens) return '/inbox';
	const id = encodeURIComponent(opens.id);
	switch (opens.kind) {
		case 'inbox':
			return '/inbox';
		case 'task':
			return `/inbox?task=${id}`;
		case 'place':
			return `/places/${id}`;
		case 'event':
			return `/events/${id}`;
		case 'project':
			return `/projects/${id}`;
		default: {
			const never: never = opens.kind;
			return never;
		}
	}
}
