import type { DateKey, Task } from 'shared/task.ts';

export type DayGroup = { date: DateKey; tasks: Task[] };

function compareTasks(a: Task, b: Task) {
	const aDue = a.due ? `${a.due.date} ${a.due.time ?? '99:99'}` : '~';
	const bDue = b.due ? `${b.due.date} ${b.due.time ?? '99:99'}` : '~';
	if (aDue !== bDue) return aDue < bDue ? -1 : 1;
	return a.priority - b.priority || a.createdAt - b.createdAt;
}

const open = (tasks: readonly Task[]) => tasks.filter(t => t.completedAt === null);

/** Inbox and projects list top-level tasks, and a subtask shows as progress on its parent. Dated views list subtasks too. */
const topLevel = (tasks: readonly Task[]) => open(tasks).filter(t => t.parentId === null);

export function inboxTasks(tasks: readonly Task[]) {
	return topLevel(tasks)
		.filter(t => t.projectId === null)
		.toSorted(compareTasks);
}

export function projectTasks(tasks: readonly Task[], projectId: string) {
	return topLevel(tasks)
		.filter(t => t.projectId === projectId)
		.toSorted(compareTasks);
}

export function labelTasks(tasks: readonly Task[], labelId: string) {
	return open(tasks)
		.filter(t => t.labelIds.includes(labelId))
		.toSorted(compareTasks);
}

export function todayTasks(tasks: readonly Task[], today: DateKey) {
	const due = open(tasks)
		.filter(t => t.due && t.due.date <= today)
		.toSorted(compareTasks);
	return {
		overdue: due.filter(t => t.due!.date < today),
		today: due.filter(t => t.due!.date === today),
	};
}

export function upcomingGroups(tasks: readonly Task[], today: DateKey): DayGroup[] {
	const groups = new Map<DateKey, Task[]>();
	for (const task of open(tasks)
		.filter(t => t.due && t.due.date > today)
		.toSorted(compareTasks)) {
		const list = groups.get(task.due!.date) ?? [];
		list.push(task);
		groups.set(task.due!.date, list);
	}
	return [...groups].map(([date, list]) => ({ date, tasks: list }));
}
