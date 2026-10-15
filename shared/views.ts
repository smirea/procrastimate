import { z } from 'zod';
import { taskSchema } from './sync/protocol.ts';
import { addDays, toDateKey, type DateKey, type Due, type Task } from './task.ts';
import { occurrenceDue, placeKey, scheduledDue } from './triggers.ts';
import { dateKeySchema } from './values.ts';

export const dayGroupSchema = z.object({ date: dateKeySchema, tasks: z.array(taskSchema) }).meta({ id: 'DayGroup' });
export type DayGroup = z.infer<typeof dayGroupSchema>;

export const placeSectionSchema = z
	.object({ key: z.string(), name: z.string(), tasks: z.array(taskSchema) })
	.meta({ id: 'PlaceSection' });
export type PlaceSection = z.infer<typeof placeSectionSchema>;

export const noDateSchema = z
	.object({ loose: z.array(taskSchema), places: z.array(placeSectionSchema) })
	.meta({ id: 'NoDate' });
export type NoDate = z.infer<typeof noDateSchema>;

export const todaySchema = z.object({ overdue: z.array(taskSchema), today: z.array(taskSchema) }).meta({ id: 'Today' });
export type Today = z.infer<typeof todaySchema>;

/** An event task sorts by the occurrence it is on, or by its first one where a list has no today. */
const sortKey = (task: Task, today?: DateKey) => {
	const due: Due | null = today
		? scheduledDue(task, today)
		: task.event
			? occurrenceDue(task.event, task.event.occurrences[0]!)
			: task.due;
	return due ? `${due.date} ${due.time ?? '99:99'}` : '~';
};

function compareTasks(a: Task, b: Task, today?: DateKey) {
	const aDue = sortKey(a, today);
	const bDue = sortKey(b, today);
	if (aDue !== bDue) return aDue < bDue ? -1 : 1;
	return a.priority - b.priority || a.createdAt - b.createdAt;
}

const open = (tasks: readonly Task[]) => tasks.filter(t => t.completedAt === null);

/** Inbox and projects list top-level tasks, and a subtask shows as progress on its parent. Dated views list subtasks too. */
const topLevel = (tasks: readonly Task[]) => open(tasks).filter(t => t.parentId === null);

/** Inbox tasks with no day. The Inbox view lists dated tasks from every project under their day instead. */
export function inboxTasks(tasks: readonly Task[], today: DateKey) {
	return topLevel(tasks)
		.filter(t => t.projectId === null && scheduledDue(t, today) === null)
		.toSorted((a, b) => compareTasks(a, b));
}

/**
 * The No date view: undated inbox tasks, with each place that has two or more of them in its own section below the
 * rest. A section is named after its earliest task's place, and sections sort by name. Tasks sort by when they were
 * added.
 */
export function noDateTasks(tasks: readonly Task[], today: DateKey, newestFirst: boolean): NoDate {
	const list = inboxTasks(tasks, today).toSorted(
		(a, b) =>
			(newestFirst ? b.createdAt - a.createdAt : a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
	const byPlace = new Map<string, Task[]>();
	for (const task of list) {
		if (task.location) byPlace.set(placeKey(task.location), [...(byPlace.get(placeKey(task.location)) ?? []), task]);
	}
	const places = [...byPlace]
		.filter(([, group]) => group.length > 1)
		.map(([key, group]) => ({
			key,
			name: group.toSorted((a, b) => a.createdAt - b.createdAt)[0]!.location!.name,
			tasks: group,
		}))
		.toSorted((a, b) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : 1));
	const grouped = new Set(places.map(p => p.key));
	return { loose: list.filter(t => !t.location || !grouped.has(placeKey(t.location))), places };
}

export function projectTasks(tasks: readonly Task[], projectId: string) {
	return topLevel(tasks)
		.filter(t => t.projectId === projectId)
		.toSorted((a, b) => compareTasks(a, b));
}

export function labelTasks(tasks: readonly Task[], labelId: string) {
	return open(tasks)
		.filter(t => t.labelIds.includes(labelId))
		.toSorted((a, b) => compareTasks(a, b));
}

/** Dated tasks with the day each sits on, which for an event or a repeat at a place is not its stored due date. */
const dated = (tasks: readonly Task[], today: DateKey) =>
	open(tasks).flatMap(task => {
		const due = scheduledDue(task, today);
		return due ? [{ task, date: due.date }] : [];
	});

export function todayTasks(tasks: readonly Task[], today: DateKey): Today {
	const due = dated(tasks, today)
		.filter(t => t.date <= today)
		.toSorted((a, b) => compareTasks(a.task, b.task, today));
	return {
		overdue: due.filter(t => t.date < today).map(t => t.task),
		today: due.filter(t => t.date === today).map(t => t.task),
	};
}

export function upcomingGroups(tasks: readonly Task[], today: DateKey): DayGroup[] {
	const groups = new Map<DateKey, Task[]>();
	for (const { task, date } of dated(tasks, today)
		.filter(t => t.date > today)
		.toSorted((a, b) => compareTasks(a.task, b.task, today))) {
		const list = groups.get(date) ?? [];
		list.push(task);
		groups.set(date, list);
	}
	return [...groups].map(([date, list]) => ({ date, tasks: list }));
}

/** Every open task at a place, subtasks included, like a label view. */
export function placeTasks(tasks: readonly Task[], key: string) {
	return open(tasks)
		.filter(t => t.location && placeKey(t.location) === key)
		.toSorted((a, b) => compareTasks(a, b));
}

/** Every open task on a calendar event, in the order their moments come. */
export function eventTasks(tasks: readonly Task[], eventId: string, today: DateKey) {
	return open(tasks)
		.filter(t => t.event?.id === eventId)
		.toSorted((a, b) => compareTasks(a, b, today));
}

export const completedPresetSchema = z.enum(['today', 'week', 'month', 'all']).meta({ id: 'CompletedPreset' });
export type CompletedPreset = z.infer<typeof completedPresetSchema>;

export const completedRangeSchema = z
	.object({ from: dateKeySchema.nullable(), to: dateKeySchema.nullable() })
	.meta({ id: 'CompletedRange', description: 'Local days, both ends included. A null end is open.' });
export type CompletedRange = z.infer<typeof completedRangeSchema>;

/** Today, the last 7 days, or the last 30 days, each counting today, or all time. */
export function completedRange(preset: CompletedPreset, today: DateKey): CompletedRange {
	switch (preset) {
		case 'today':
			return { from: today, to: today };
		case 'week':
			return { from: addDays(today, -6), to: today };
		case 'month':
			return { from: addDays(today, -29), to: today };
		case 'all':
			return { from: null, to: null };
		default: {
			const never: never = preset;
			return never;
		}
	}
}

/**
 * When the task was last completed: a done task's `completedAt`, or the last roll of a task that repeats. A repeating
 * task keeps no history of earlier rolls, so it counts once, at its latest. A reopened task keeps `lastCompletedAt`,
 * which is why the repeat has to be there too.
 */
export function completedMoment(task: Task): number | null {
	if (task.completedAt !== null) return task.completedAt;
	return task.recurrence || task.event?.series ? task.lastCompletedAt : null;
}

/**
 * Completed tasks in `range`, newest first. A subtask completed along with its parent shows as the parent's progress
 * instead of its own row, since completing a parent completes every open subtask at the same moment.
 */
export function completedTasks(tasks: readonly Task[], range: CompletedRange): Task[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	return tasks
		.flatMap(task => {
			const at = completedMoment(task);
			if (at === null) return [];
			const parent = task.parentId ? byId.get(task.parentId) : undefined;
			if (parent && parent.completedAt === task.completedAt) return [];
			const day = toDateKey(new Date(at));
			if ((range.from && day < range.from) || (range.to && day > range.to)) return [];
			return [{ task, at }];
		})
		.toSorted((a, b) => b.at - a.at || (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0))
		.map(entry => entry.task);
}

/** Completed tasks in `range` under the local day each was completed, newest day first. */
export function completedDays(tasks: readonly Task[], range: CompletedRange): DayGroup[] {
	const groups = new Map<DateKey, Task[]>();
	for (const task of completedTasks(tasks, range)) {
		const day = toDateKey(new Date(completedMoment(task)!));
		groups.set(day, [...(groups.get(day) ?? []), task]);
	}
	return [...groups].map(([date, list]) => ({ date, tasks: list }));
}
