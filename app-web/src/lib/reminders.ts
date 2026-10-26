import { caughtUpNotification } from 'shared/notifications.ts';
import { pushTag } from 'shared/push.ts';
import { openNotification, push } from './push.svelte.ts';
import { store } from './store.svelte.ts';

/**
 * Shows one system notification for every due time and reminder that came up since the last check, while the app is
 * open and no push can deliver it: push is off, or the browser is offline. Offline it shows under the push's tag, so a
 * push delivered on reconnect replaces it instead of showing twice.
 */
export function notifyDueReminders(now: number) {
	const since = store.remindersCheckedAt;
	store.markRemindersChecked(now);
	if (push.state.kind === 'on' && navigator.onLine) return;
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
	const due = caughtUpNotification(store.own.tasks, since, now);
	if (!due) return;
	const notification = new Notification(due.title, { body: due.body, tag: pushTag(due) });
	notification.onclick = () => {
		window.focus();
		openNotification(due.opens);
	};
}
