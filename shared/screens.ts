import type { AccessRow } from './db/schema.ts';
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

/** A space someone shared with this user, as far as adding goes: its `access` rows to them. */
export type SharedSpace = { access: readonly AccessRow[] };

/**
 * Whether a new task may land on `screen`'s project or label, in `space` when someone shared it with this user. The
 * user's own lists, and every other screen, always take one. In a shared space the server only admits a new task an
 * edit share on that project or label, or on the whole space, reaches, and writes `edit` on the list's `access` row
 * exactly then (`server/src/access.ts`), so the list takes one when its row says so.
 */
export function canAddTo(screen: Screen | null, space: SharedSpace | null): boolean {
	if (!space || (screen?.kind !== 'project' && screen?.kind !== 'label')) return true;
	return space.access.some(row => row.kind === screen.kind && row.entityId === screen.id && row.role === 'edit');
}

/**
 * The earliest open task's copy, the one a place's or event's name comes from. Once every task there is done, the
 * screen can stay open, so the latest done task's copy keeps quick add on it.
 */
const earliest = (tasks: readonly Task[], match: (task: Task) => boolean) => {
	const matching = tasks.filter(match);
	const open = matching.filter(t => t.completedAt === null).toSorted((a, b) => a.createdAt - b.createdAt)[0];
	return open ?? matching.toSorted((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
};

/**
 * Quick add inherits the screen it opens from, so the new task lands on that screen: its project and section, its
 * label, its place, its event, or the day of an Inbox heading. Inbox itself adds an undated task, as capture always
 * has, and so do No date, Completed, and a shared project or label the user can't add to (`canAddTo`).
 */
export function screenDefaults(screen: Screen | null, tasks: readonly Task[], space: SharedSpace | null): ListDefaults {
	if (!canAddTo(screen, space)) return NO_DEFAULTS;
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
