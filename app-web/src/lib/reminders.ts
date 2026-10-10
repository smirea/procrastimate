import { reminderFiresAt, type Reminder } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { sheets, toasts } from './ui.svelte.ts';

export function requestNotificationPermission(reminders: readonly Reminder[]) {
	if (reminders.length && typeof Notification !== 'undefined' && Notification.permission === 'default') {
		void Notification.requestPermission();
	}
}

/** Fires every reminder that came due since the last check, while the app is open. */
export function fireDueReminders(now: number) {
	const since = store.remindersCheckedAt;
	for (const task of store.tasks) {
		if (task.completedAt !== null) continue;
		const due = task.reminders.some(r => {
			const at = reminderFiresAt(r, task.due)?.getTime();
			return at !== undefined && at > since && at <= now;
		});
		if (!due) continue;
		toasts.show(`Reminder: ${task.title}`, { label: 'Open', run: () => sheets.openTask(task.id) }, 12_000);
		if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
			new Notification(task.title, { body: 'Procrastimate reminder', tag: task.id });
		}
	}
	store.markRemindersChecked(now);
}
