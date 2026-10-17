import type { DateKey, Task } from './task.ts';
import { placeKey, scheduledDue } from './triggers.ts';
import type { TaskEvent, TaskLocation } from './values.ts';

/**
 * A list screen, on any client. A project screen names a section, and Inbox a day, when quick add opens from that
 * section's or day's heading.
 */
export type Screen =
	| { kind: 'inbox'; date?: DateKey | null }
	| { kind: 'no-date' }
	| { kind: 'completed' }
	| { kind: 'project'; id: string; sectionId?: string | null }
	| { kind: 'label'; id: string }
	| { kind: 'place'; key: string }
	| { kind: 'event'; id: string };

/** What quick add and Ramble start with. An event stands in for the date and the repeat. */
export type ListDefaults = {
	projectId: string | null;
	sectionId: string | null;
	labelId: string | null;
	location: TaskLocation | null;
	event: TaskEvent | null;
	date: DateKey | null;
};

export const NO_DEFAULTS: ListDefaults = {
	projectId: null,
	sectionId: null,
	labelId: null,
	location: null,
	event: null,
	date: null,
};

/** The earliest open task's copy, the one a place's or event's name comes from. */
const earliest = (tasks: readonly Task[], match: (task: Task) => boolean) =>
	tasks.filter(t => t.completedAt === null && match(t)).toSorted((a, b) => a.createdAt - b.createdAt)[0];

/**
 * Quick add inherits the screen it opens from, so the new task lands on that screen: its project and section, its
 * label, its place, its event, or the day of an Inbox heading. Inbox itself adds an undated task, as capture always
 * has, and so do No date and Completed.
 */
export function screenDefaults(screen: Screen | null, tasks: readonly Task[]): ListDefaults {
	switch (screen?.kind) {
		case undefined:
		case 'no-date':
		case 'completed':
			return NO_DEFAULTS;
		case 'inbox':
			return { ...NO_DEFAULTS, date: screen.date ?? null };
		case 'project':
			return { ...NO_DEFAULTS, projectId: screen.id, sectionId: screen.sectionId ?? null };
		case 'label':
			return { ...NO_DEFAULTS, labelId: screen.id };
		case 'place': {
			const location = earliest(tasks, t => t.location !== null && placeKey(t.location) === screen.key)?.location;
			return { ...NO_DEFAULTS, location: location ?? null };
		}
		case 'event':
			return { ...NO_DEFAULTS, event: earliest(tasks, t => t.event?.id === screen.id)?.event ?? null };
		default: {
			const never: never = screen;
			return never;
		}
	}
}

/** Whether `task` shows on `screen`, so saving it from there keeps the screen open. */
export function screenHolds(screen: Screen | null, task: Task, today: DateKey, zone?: string): boolean {
	switch (screen?.kind) {
		case undefined:
		case 'completed':
			return false;
		case 'inbox':
			return scheduledDue(task, today, zone) !== null;
		case 'no-date':
			return task.projectId === null && task.parentId === null && scheduledDue(task, today, zone) === null;
		case 'project':
			return task.projectId === screen.id;
		case 'label':
			return task.labelIds.includes(screen.id);
		case 'place':
			return task.location !== null && placeKey(task.location) === screen.key;
		case 'event':
			return task.event?.id === screen.id;
		default: {
			const never: never = screen;
			return never;
		}
	}
}
