import { self } from '$app/service-worker';
import type { PushMessage } from 'shared/push.ts';

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// iOS revokes the subscription of a site whose push shows nothing, so every push shows a notification.
self.addEventListener('push', event => {
	const message = parse(event.data?.text());
	event.waitUntil(
		self.registration.showNotification(message.title, {
			body: message.body,
			tag: message.tag,
			icon: '/icons/icon-192.png',
			badge: '/icons/badge-96.png',
			data: { taskId: message.taskId },
		}),
	);
});

self.addEventListener('notificationclick', event => {
	event.notification.close();
	const taskId: string | null = event.notification.data?.taskId ?? null;
	event.waitUntil(open(taskId));
});

async function open(taskId: string | null) {
	const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	if (client) {
		await client.focus();
		client.postMessage({ type: 'open-task', taskId });
		return;
	}
	await self.clients.openWindow(taskId ? `/today?task=${encodeURIComponent(taskId)}` : '/today');
}

function parse(text: string | undefined): PushMessage {
	try {
		const message = JSON.parse(text ?? '');
		if (typeof message?.title === 'string') {
			return {
				title: message.title,
				body: typeof message.body === 'string' ? message.body : '',
				tag: typeof message.tag === 'string' ? message.tag : '',
				taskId: typeof message.taskId === 'string' ? message.taskId : null,
			};
		}
	} catch {}
	return { title: 'Procrastimate', body: 'A task is due', tag: '', taskId: null };
}
