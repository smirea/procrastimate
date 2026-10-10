import { notificationTimes, type Due, type Reminder } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { sheets, toasts } from './ui.svelte.ts';

export function requestNotificationPermission(due: Due | null, reminders: readonly Reminder[]) {
	if (
		notificationTimes(due, reminders).length &&
		typeof Notification !== 'undefined' &&
		Notification.permission === 'default'
	) {
		void Notification.requestPermission();
	}
}

/** Notifies once for every task whose due time or reminder came up since the last check, while the app is open. */
export function fireDueReminders(now: number) {
	const since = store.remindersCheckedAt;
	for (const task of store.tasks) {
		if (task.completedAt !== null) continue;
		const due = notificationTimes(task.due, task.reminders).some(t => t.getTime() > since && t.getTime() <= now);
		if (!due) continue;
		toasts.show(`Reminder: ${task.title}`, { label: 'Open', run: () => sheets.openTask(task.id) }, 12_000);
		if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
			new Notification(task.title, { body: 'Procrastimate reminder', tag: task.id });
		}
	}
	store.markRemindersChecked(now);
}
