import { reminderToast } from 'shared/format.ts';
import { notificationTimes } from 'shared/task.ts';
import { push } from './push.svelte.ts';
import { store } from './store.svelte.ts';
import { sheets, toasts } from './ui.svelte.ts';

/** Notifies once for every task whose due time or reminder came up since the last check, while the app is open. */
export function fireDueReminders(now: number) {
	const since = store.remindersCheckedAt;
	for (const task of store.tasks) {
		if (task.completedAt !== null) continue;
		const due = notificationTimes(task.due, task.reminders).some(t => t.getTime() > since && t.getTime() <= now);
		if (!due) continue;
		toasts.show(reminderToast(task.title), { label: 'Open', run: () => sheets.openTask(task.id) }, 12_000);
		// With push on, the pushed notification is the system one, so a local one would show it twice.
		if (push.state.kind !== 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
			new Notification(task.title, { body: 'Procrastimate reminder', tag: task.id });
		}
	}
	store.markRemindersChecked(now);
}
