import { taskNotificationBody } from 'shared/notifications.ts';
import { pushTag } from 'shared/push.ts';
import { toDateKey } from 'shared/task.ts';
import { taskNotificationTimes } from 'shared/triggers.ts';
import { push } from './push.svelte.ts';
import { store } from './store.svelte.ts';
import { sheets } from './ui.svelte.ts';

/**
 * Shows a system notification for every task whose due time or reminder came up since the last check, while the app is
 * open and no push can deliver it: push is off, or the browser is offline. Offline it shows under the push's tag, so a
 * push delivered on reconnect replaces it instead of showing twice.
 */
export function notifyDueReminders(now: number) {
	const since = store.remindersCheckedAt;
	store.markRemindersChecked(now);
	if (push.state.kind === 'on' && navigator.onLine) return;
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
	const today = toDateKey(new Date(now));
	for (const task of store.own.tasks) {
		if (task.completedAt !== null) continue;
		const due = taskNotificationTimes(task, today).find(t => t.getTime() > since && t.getTime() <= now);
		if (!due) continue;
		const notification = new Notification(task.title, {
			body: taskNotificationBody(task, due.getTime(), today),
			tag: pushTag({ taskId: task.id, at: due.getTime() }),
		});
		notification.onclick = () => {
			window.focus();
			sheets.openTask(task.id);
		};
	}
}
