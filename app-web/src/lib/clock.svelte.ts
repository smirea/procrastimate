import { toDateKey } from 'shared/task.ts';

/** Minute-resolution clock, so Today rolls over at midnight and reminders fire while the app is open. */
class Clock {
	now = $state(Date.now());
	today = $derived(toDateKey(new Date(this.now)));

	start() {
		const id = setInterval(() => (this.now = Date.now()), 15_000);
		return () => clearInterval(id);
	}
}

export const clock = new Clock();
