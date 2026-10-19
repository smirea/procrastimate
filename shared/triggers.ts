import { z } from 'zod';
import { formatDue, formatMinutes, formatTime } from './format.ts';
import {
	notificationTimes,
	reminderFiresAt,
	stepRecurrence,
	type DateKey,
	type Due,
	type Label,
	type Task,
} from './task.ts';
import type { EventOccurrence, LocationTrigger, SavedPlace, TaskEvent, TaskLocation } from './values.ts';
import { compareIds } from './order.ts';
import { zonedDateKey, zonedTimeOfDay } from './zoned-time.ts';

/**
 * Tasks that hang off a place or a calendar event. Only iOS sets them, since only it can watch places and read the
 * calendar, but every client lists them and the push server schedules event times from the synced copy.
 */

type Scheduled = Pick<Task, 'due' | 'recurrence' | 'reminders' | 'location' | 'event'>;

const MINUTE = 60_000;

/** The moment the task's edge names on one occurrence: `minutes` before the start, the start, or `minutes` after the end. */
export function eventAnchor(event: TaskEvent, occurrence: EventOccurrence): number {
	switch (event.edge) {
		case 'before':
			return occurrence.start - event.minutes * MINUTE;
		case 'start':
		case 'during':
			return occurrence.start;
		case 'after':
			return occurrence.end + event.minutes * MINUTE;
		default: {
			const never: never = event.edge;
			return never;
		}
	}
}

/**
 * The occurrence a task is on. A single event keeps its one occurrence after it passes, so the task goes overdue. A
 * task that follows a series skips occurrences whose day is over, so a missed one never shows as overdue.
 */
export function currentOccurrence(event: TaskEvent, today: DateKey, zone?: string): EventOccurrence {
	if (!event.series) return event.occurrences[0]!;
	return event.occurrences.find(o => zonedDateKey(eventAnchor(event, o), zone) >= today) ?? event.occurrences.at(-1)!;
}

/** An occurrence's moment as a due date, without a time for an all-day event. */
export function occurrenceDue(event: TaskEvent, occurrence: EventOccurrence, zone?: string): Due {
	const at = eventAnchor(event, occurrence);
	return { date: zonedDateKey(at, zone), time: event.allDay ? null : zonedTimeOfDay(at, zone) };
}

/**
 * The day and time a task sits on in lists. An event task sits on its current occurrence. A repeating task with a
 * place never goes overdue: a missed occurrence is skipped to the first one from today, while a single one stays
 * overdue like any task.
 */
export function scheduledDue(task: Scheduled, today: DateKey, zone?: string): Due | null {
	if (task.event) return occurrenceDue(task.event, currentOccurrence(task.event, today, zone), zone);
	const { due, recurrence } = task;
	if (!task.location || !recurrence || !due || due.date >= today) return due;
	let date: DateKey | null = due.date;
	while (date !== null && date < today) date = stepRecurrence(date, recurrence);
	return date === null ? due : { date, time: due.time };
}

/**
 * When a task notifies, each moment once. An event task notifies at each upcoming occurrence's moment, unless the
 * event lasts all day, like a date with no time, and relative reminders count back from that moment. A task with a
 * place gets nothing at its due time, since arriving or leaving is its nudge, though its reminders still fire. Other
 * tasks notify as `notificationTimes` says.
 */
export function taskNotificationTimes(task: Scheduled, today: DateKey, zone?: string): Date[] {
	const { event } = task;
	if (!event && !task.location) return notificationTimes(task.due, task.reminders, zone);
	const moments: (Date | null)[] = [];
	if (event) {
		for (const occurrence of event.series ? event.occurrences : event.occurrences.slice(0, 1)) {
			const due = occurrenceDue(event, occurrence, zone);
			if (!event.allDay) moments.push(new Date(eventAnchor(event, occurrence)));
			moments.push(...task.reminders.map(r => reminderFiresAt(r, due, zone)));
		}
	} else {
		const due = scheduledDue(task, today, zone);
		moments.push(...task.reminders.map(r => reminderFiresAt(r, due, zone)));
	}
	const unique = new Map(moments.filter(t => t !== null).map(t => [t.getTime(), t]));
	return [...unique.values()].sort((a, b) => a.getTime() - b.getTime());
}

/** `30m before Night out`, `When Walking meetup starts`, `During Walking meetup`, `After Workshop`, `1h after Workshop`. */
export function formatEvent(event: TaskEvent): string {
	switch (event.edge) {
		case 'before':
			return event.minutes ? `${formatMinutes(event.minutes)} before ${event.title}` : `When ${event.title} starts`;
		case 'start':
			return `When ${event.title} starts`;
		case 'during':
			return `During ${event.title}`;
		case 'after':
			return event.minutes ? `${formatMinutes(event.minutes)} after ${event.title}` : `After ${event.title}`;
		default: {
			const never: never = event.edge;
			return never;
		}
	}
}

export const eventLabelSchema = z
	.object({ lead: z.string(), title: z.string(), when: z.string().nullable() })
	.meta({ id: 'EventLabel' });
export type EventLabel = z.infer<typeof eventLabelSchema>;

/**
 * A row's event line in parts: `4:15pm` `(15m after` `Standup)`, with icons before the title. `when` is the task's
 * moment on the occurrence it is on, worded like any due date but without the day when it is today. A row shows it
 * even under a day heading, which is easy to lose in a long list.
 */
export function eventLabel(event: TaskEvent, today: DateKey, zone?: string): EventLabel {
	const lead = (() => {
		switch (event.edge) {
			case 'before':
				return event.minutes ? `${formatMinutes(event.minutes)} before` : 'Start of';
			case 'start':
				return 'Start of';
			case 'during':
				return 'During';
			case 'after':
				return event.minutes ? `${formatMinutes(event.minutes)} after` : 'After';
			default: {
				const never: never = event.edge;
				return never;
			}
		}
	})();
	const due = occurrenceDue(event, currentOccurrence(event, today, zone), zone);
	const when = due.date !== today ? formatDue(due, today) : due.time ? formatTime(due.time) : null;
	return { lead, title: event.title, when };
}

/** `Arriving at Rewe`, `Leaving Rewe`, `While at Rewe`. */
export function formatLocation(location: TaskLocation): string {
	switch (location.trigger) {
		case 'arrive':
			return `Arriving at ${location.name}`;
		case 'leave':
			return `Leaving ${location.name}`;
		case 'during':
			return `While at ${location.name}`;
		default: {
			const never: never = location.trigger;
			return never;
		}
	}
}

/** A watched radius as it reads on a chip: `150 m`, `1.5 km`, `22 km`. */
export function formatRadius(meters: number): string {
	if (Math.round(meters / 10) * 10 < 1000) return `${Math.round(meters / 10) * 10} m`;
	const tenths = Math.round(meters / 100) / 10;
	return tenths < 10 ? `${tenths} km` : `${Math.round(meters / 1000)} km`;
}

/** Tasks at the same spot share a place, to about 11 meters, whatever each one named it. */
export const placeKey = (location: Pick<TaskLocation, 'latitude' | 'longitude'>) =>
	`${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;

export const placeGroupSchema = z
	.object({ key: z.string(), name: z.string(), count: z.number().int() })
	.meta({ id: 'PlaceGroup' });
export type PlaceGroup = z.infer<typeof placeGroupSchema>;

export const eventGroupSchema = z
	.object({ id: z.string(), title: z.string(), count: z.number().int() })
	.meta({ id: 'EventGroup' });
export type EventGroup = z.infer<typeof eventGroupSchema>;

export const openTasks = (tasks: readonly Task[]) => tasks.filter(t => t.completedAt === null);
const open = openTasks;

export type SavedPlaceLabel = Label & { place: SavedPlace };

export const isSavedPlace = (label: Label): label is SavedPlaceLabel => label.place !== null;

/** The saved place at a spot, if one is. */
export function savedPlaceAt(labels: readonly Label[], key: string): SavedPlaceLabel | null {
	return labels.filter(isSavedPlace).find(l => placeKey(l.place) === key) ?? null;
}

/** A saved place as a task's place, under its saved name and radius. */
export function placeLocation(label: SavedPlaceLabel, trigger: LocationTrigger): TaskLocation {
	return { name: label.name, ...label.place, trigger };
}

type Placed = Pick<Task, 'labelIds' | 'location'>;

/** What a label picker shows checked: the task's labels, then the saved place it sits at. */
export function pickedLabels(labels: readonly Label[], task: Placed): string[] {
	const place = task.location && savedPlaceAt(labels, placeKey(task.location));
	return place ? [...task.labelIds, place.id] : task.labelIds;
}

/**
 * What a label picker's checked ids save. Saved places are not kept as labels: the last one checked becomes the task's
 * place, keeping its trigger, since a task has one place. With none checked, a task at a saved place leaves it, and a
 * place set on iPhone that was never saved stays.
 */
export function applyPickedLabels(
	labels: readonly Label[],
	ids: readonly string[],
	location: TaskLocation | null,
): Placed {
	const places = labels.filter(isSavedPlace);
	const place = ids.flatMap(id => places.filter(l => l.id === id)).at(-1);
	const kept = location && !savedPlaceAt(labels, placeKey(location)) ? location : null;
	return {
		labelIds: ids.filter(id => !places.some(l => l.id === id)),
		location: place ? placeLocation(place, location?.trigger ?? 'arrive') : kept,
	};
}

/**
 * The places open tasks hang off, by name, each named after its earliest task. A saved place lists with the labels
 * instead, so it is left out. Empty hides the sidebar section.
 */
export function placeGroups(tasks: readonly Task[], labels: readonly Label[]): PlaceGroup[] {
	const saved = new Set(labels.filter(isSavedPlace).map(l => placeKey(l.place)));
	const groups = new Map<string, PlaceGroup>();
	for (const task of open(tasks).toSorted((a, b) => a.createdAt - b.createdAt)) {
		if (!task.location) continue;
		const key = placeKey(task.location);
		if (saved.has(key)) continue;
		const group = groups.get(key) ?? { key, name: task.location.name, count: 0 };
		group.count++;
		groups.set(key, group);
	}
	return [...groups.values()].toSorted((a, b) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : 1));
}

/** The calendar events open tasks hang off, soonest first. Empty hides the sidebar section. */
export function eventGroups(tasks: readonly Task[], today: DateKey): EventGroup[] {
	const groups = new Map<string, EventGroup & { at: number }>();
	for (const task of open(tasks).toSorted((a, b) => a.createdAt - b.createdAt)) {
		if (!task.event) continue;
		const at = currentOccurrence(task.event, today).start;
		const group = groups.get(task.event.id) ?? { id: task.event.id, title: task.event.title, count: 0, at };
		group.count++;
		group.at = Math.min(group.at, at);
		groups.set(task.event.id, group);
	}
	return [...groups.values()]
		.toSorted((a, b) => a.at - b.at || compareIds(a.id, b.id))
		.map(({ id, title, count }) => ({ id, title, count }));
}
