import { z } from 'zod';
import { sectionsOf } from './store.ts';
import { sectionSchema, taskSchema } from './model.ts';
import {
	addDays,
	mondayIndex,
	toDateKey,
	weekdayOf,
	type DateKey,
	type Due,
	type Label,
	type Section,
	type Task,
} from './task.ts';
import { filterTasks, listFilterSchema } from './list-filters.ts';
import { compareIds } from './order.ts';
import { ancestorsIn, occurrenceDue, openTasks, placeKey, scheduledDue } from './triggers.ts';
import { dateKeySchema } from './values.ts';

export const dayGroupSchema = z.object({ date: dateKeySchema, tasks: z.array(taskSchema) }).meta({ id: 'DayGroup' });
export type DayGroup = z.infer<typeof dayGroupSchema>;

export const projectGroupSchema = z
	.object({ section: sectionSchema.nullable(), tasks: z.array(taskSchema) })
	.meta({ id: 'ProjectGroup', description: 'One heading of a project view. The group with no section has none.' });
export type ProjectGroup = z.infer<typeof projectGroupSchema>;

export const projectCompletedSchema = z
	.object({ groups: z.array(projectGroupSchema), gone: z.array(taskSchema) })
	.meta({
		id: 'ProjectCompleted',
		description: "A project's done tasks under the same headings as its open ones, and those whose section is gone.",
	});
export type ProjectCompleted = z.infer<typeof projectCompletedSchema>;

export const todaySchema = z.object({ overdue: z.array(taskSchema), today: z.array(taskSchema) }).meta({ id: 'Today' });
export type Today = z.infer<typeof todaySchema>;

export const sectionBadgeSchema = z.object({ count: z.number().int(), due: z.boolean() }).meta({
	id: 'SectionBadge',
	description:
		"A section heading's opt-in pill. `due` paints it like the Inbox tab's badge; otherwise it is in the accent.",
});
export type SectionBadge = z.infer<typeof sectionBadgeSchema>;

export const dueListSchema = z.enum(['inbox', 'tomorrow', 'this-week']).meta({ id: 'DueList' });
export type DueList = z.infer<typeof dueListSchema>;

export const dueDaysSchema = z
	.object({ overdue: z.array(taskSchema), today: z.array(taskSchema), days: z.array(dayGroupSchema) })
	.meta({ id: 'DueDays', description: "A dated list's tasks: overdue, today's, then each later day it covers." });
export type DueDays = z.infer<typeof dueDaysSchema>;

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

const open = openTasks;

/** Inbox and projects list top-level tasks, and a subtask shows as progress on its parent. Dated views list subtasks too. */
const topLevel = (tasks: readonly Task[]) => open(tasks).filter(t => t.parentId === null);

/**
 * The count a header over a list shows: its open rows once there are more than 4, since a glance covers a shorter list.
 * Pass the rows the list shows, so a subtask counts only where it has a row of its own.
 */
export function pendingCount(open: number): number | null {
	return open > 4 ? open : null;
}

/** Inbox tasks with no day. The Inbox view lists dated tasks from every project under their day instead. */
export function inboxTasks(tasks: readonly Task[], today: DateKey) {
	return topLevel(tasks)
		.filter(t => t.projectId === null && scheduledDue(t, today) === null)
		.toSorted((a, b) => compareTasks(a, b));
}

/** The No date view: undated inbox tasks in one list, by when they were added, with no sections. */
export function noDateTasks(tasks: readonly Task[], today: DateKey, newestFirst: boolean): Task[] {
	return inboxTasks(tasks, today).toSorted(
		(a, b) => (newestFirst ? b.createdAt - a.createdAt : a.createdAt - b.createdAt) || compareIds(a.id, b.id),
	);
}

export function projectTasks(tasks: readonly Task[], projectId: string) {
	return topLevel(tasks)
		.filter(t => t.projectId === projectId)
		.toSorted((a, b) => compareTasks(a, b));
}

/**
 * A project's open top-level tasks under its sections: the tasks in no section first, then every section in its order,
 * empty ones included so each stays a place to add to.
 */
export function projectGroups(tasks: readonly Task[], sections: readonly Section[], projectId: string): ProjectGroup[] {
	const list = projectTasks(tasks, projectId);
	const own = sectionsOf(sections, projectId);
	const placed = new Set(own.map(s => s.id));
	return [
		{ section: null, tasks: list.filter(t => t.sectionId === null || !placed.has(t.sectionId)) },
		...own.map(section => ({ section, tasks: list.filter(t => t.sectionId === section.id) })),
	];
}

export function labelTasks(tasks: readonly Task[], labelId: string) {
	return open(tasks)
		.filter(t => t.labelIds.includes(labelId))
		.toSorted((a, b) => compareTasks(a, b));
}

/** The days a dated list covers, both ends included. A null end is open. */
type Span = { from: DateKey | null; to: DateKey | null };

const dayIn = (task: Task, today: DateKey, span: Span): DateKey | null => {
	const date = scheduledDue(task, today)?.date;
	return date && (span.from === null || date >= span.from) && (span.to === null || date <= span.to) ? date : null;
};

export const dueFilterSchema = z.object({ filter: listFilterSchema, me: z.string() }).meta({
	id: 'DueFilter',
	description: "A dated list's filter menu, and who the user is, since a filter on people reads a task's creator.",
});
export type DueFilter = z.infer<typeof dueFilterSchema>;

/**
 * The rows of a dated list over `span`, each with the day it sits on, which for an event or a repeat at a place is not
 * its stored due date. A subtask has a row of its own only while no task above it has one in the same list: under a
 * listed task it shows as that task's progress, as in a project, and once none above it is listed it shows alone. The
 * filter runs first, so a subtask whose parent the filter hides gets its own row.
 */
const dated = (tasks: readonly Task[], today: DateKey, span: Span, filtered?: DueFilter) => {
	const open = openTasks(tasks);
	const days = new Map<string, DateKey>();
	for (const task of filtered ? filterTasks(open, filtered.filter, filtered.me) : open) {
		const date = dayIn(task, today, span);
		if (date) days.set(task.id, date);
	}
	const byId = new Map(open.map(t => [t.id, t]));
	return open.flatMap(task => {
		const date = days.get(task.id);
		return date && !ancestorsIn(byId, task).some(p => days.has(p.id)) ? [{ task, date }] : [];
	});
};

/** A dated list's rows: overdue, today's, then each later day. */
function byDay(tasks: readonly Task[], today: DateKey, span: Span, filtered?: DueFilter): DueDays {
	const rows = dated(tasks, today, span, filtered).toSorted((a, b) => compareTasks(a.task, b.task, today));
	const groups = new Map<DateKey, Task[]>();
	for (const { task, date } of rows.filter(t => t.date > today)) groups.set(date, [...(groups.get(date) ?? []), task]);
	return {
		overdue: rows.filter(t => t.date < today).map(t => t.task),
		today: rows.filter(t => t.date === today).map(t => t.task),
		days: [...groups].map(([date, list]) => ({ date, tasks: list })),
	};
}

/**
 * The pill a section with `counter: 'badge'` shows over its open rows: the overdue and today's ones when it has any, the
 * same rule as the Inbox badge, else every open row. An empty section shows none.
 */
export function sectionBadge(rows: readonly Task[], today: DateKey): SectionBadge | null {
	const due = todayTasks(rows, today);
	const count = due.overdue.length + due.today.length;
	if (count) return { count, due: true };
	return rows.length ? { count: rows.length, due: false } : null;
}

/** The overdue and today's tasks, as a list of only those days shows them. */
export function todayTasks(tasks: readonly Task[], today: DateKey): Today {
	const { overdue, today: due } = byDay(tasks, today, { from: null, to: today });
	return { overdue, today: due };
}

export function upcomingGroups(tasks: readonly Task[], today: DateKey): DayGroup[] {
	return byDay(tasks, today, { from: addDays(today, 1), to: null }).days;
}

/** The last day This week lists: the coming Sunday, or today on a Sunday, since weeks start on Monday. */
export const weekEnd = (today: DateKey): DateKey => addDays(today, 6 - mondayIndex(weekdayOf(today)));

/**
 * The days a dated list covers. Inbox lists every dated task, This week the overdue ones through the end of the week,
 * and Tomorrow only tomorrow's, since overdue tasks are already today's business.
 */
export function dueDays(tasks: readonly Task[], today: DateKey, list: DueList, filtered?: DueFilter): DueDays {
	return byDay(tasks, today, spanOf(list, today), filtered);
}

function spanOf(list: DueList, today: DateKey): Span {
	switch (list) {
		case 'inbox':
			return { from: null, to: null };
		case 'this-week':
			return { from: null, to: weekEnd(today) };
		case 'tomorrow':
			return { from: addDays(today, 1), to: addDays(today, 1) };
		default: {
			const never: never = list;
			return never;
		}
	}
}

/**
 * What a dated list's filter menu counts: every open task due in the days it covers, subtasks under a listed task
 * included, so a choice that would surface a subtask by hiding its parent is offered.
 */
export function dueCandidates(tasks: readonly Task[], today: DateKey, list: DueList): Task[] {
	const span = spanOf(list, today);
	return openTasks(tasks).filter(task => dayIn(task, today, span) !== null);
}

export function placeTasks(tasks: readonly Task[], key: string) {
	return open(tasks)
		.filter(t => t.location && placeKey(t.location) === key)
		.toSorted((a, b) => compareTasks(a, b));
}

export function labelViewTasks(tasks: readonly Task[], label: Label) {
	return label.place ? placeTasks(tasks, placeKey(label.place)) : labelTasks(tasks, label.id);
}

/**
 * How many open tasks each project and label view lists, in one pass, for the sidebar's counts: a project counts its
 * top-level tasks, a label every task carrying it, and a saved place every task at it, as the views do.
 */
export function openCounts(
	tasks: readonly Task[],
	labels: readonly Label[],
): { projects: Map<string, number>; labels: Map<string, number> } {
	const projects = new Map<string, number>();
	const byLabel = new Map<string, number>();
	const byPlace = new Map<string, number>();
	const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
	for (const task of open(tasks)) {
		if (task.parentId === null && task.projectId) bump(projects, task.projectId);
		for (const id of task.labelIds) bump(byLabel, id);
		if (task.location) bump(byPlace, placeKey(task.location));
	}
	const counts = new Map<string, number>();
	for (const label of labels) {
		counts.set(label.id, (label.place ? byPlace.get(placeKey(label.place)) : byLabel.get(label.id)) ?? 0);
	}
	return { projects, labels: counts };
}

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
			if (task.completedAt !== null && parent?.completedAt === task.completedAt) return [];
			const day = toDateKey(new Date(at));
			if ((range.from && day < range.from) || (range.to && day > range.to)) return [];
			return [{ task, at }];
		})
		.toSorted((a, b) => b.at - a.at || (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0))
		.map(entry => entry.task);
}

export function completedDays(tasks: readonly Task[], range: CompletedRange): DayGroup[] {
	const groups = new Map<DateKey, Task[]>();
	for (const task of completedTasks(tasks, range)) {
		const day = toDateKey(new Date(completedMoment(task)!));
		groups.set(day, [...(groups.get(day) ?? []), task]);
	}
	return [...groups].map(([date, list]) => ({ date, tasks: list }));
}

/**
 * A project's completed tasks, all time and newest first, under the same headings as `projectGroups`, so each shows in
 * its section below the open ones. A subtask goes with its top-level task's section. A done task whose section is not
 * one of the project's live sections goes in `gone`, which the views show at the bottom.
 */
export function projectCompleted(
	tasks: readonly Task[],
	sections: readonly Section[],
	projectId: string,
): ProjectCompleted {
	const byId = new Map(tasks.map(t => [t.id, t]));
	const sectionOf = (task: Task): string | null => {
		let root = task;
		for (let parent = byId.get(root.parentId ?? ''); parent; parent = byId.get(root.parentId ?? '')) root = parent;
		return root.sectionId;
	};
	const done = completedTasks(
		tasks.filter(t => t.projectId === projectId),
		{ from: null, to: null },
	).map(task => ({ task, sectionId: sectionOf(task) }));
	const own = sectionsOf(sections, projectId);
	const placed = new Set(own.map(s => s.id));
	const tasksIn = (sectionId: string | null) => done.filter(d => d.sectionId === sectionId).map(d => d.task);
	return {
		groups: [{ section: null, tasks: tasksIn(null) }, ...own.map(section => ({ section, tasks: tasksIn(section.id) }))],
		gone: done.filter(d => d.sectionId !== null && !placed.has(d.sectionId)).map(d => d.task),
	};
}
