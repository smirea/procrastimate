import { z } from 'zod';
import { taskSchema } from './sync/protocol.ts';
import type { DateKey, Due, Task } from './task.ts';
import { occurrenceDue, placeKey, scheduledDue } from './triggers.ts';
import { dateKeySchema } from './values.ts';

export const dayGroupSchema = z.object({ date: dateKeySchema, tasks: z.array(taskSchema) }).meta({ id: 'DayGroup' });
export type DayGroup = z.infer<typeof dayGroupSchema>;

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
