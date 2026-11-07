import type { AccessRow } from './db/schema.ts';
import type { ListEntry } from './lists.ts';
import type { NotificationTarget } from './notifications.ts';
import { addDays, type DateKey, type Label, type Project, type Task } from './task.ts';
import { pickedLabels, placeKey, scheduledDue } from './triggers.ts';
import type { TaskEvent, TaskLocation } from './values.ts';
import { weekEnd } from './views.ts';

/**
 * A list screen, on any client. A project screen names a section, and Inbox a day, when quick add opens from that
 * section's or day's heading.
 */
export type Screen =
	| { kind: 'inbox'; date?: DateKey | null }
	| { kind: 'tomorrow' }
	| { kind: 'this-week'; date?: DateKey | null }
	| { kind: 'no-date' }
	| { kind: 'completed' }
	| { kind: 'project'; id: string; sectionId?: string | null }
	| { kind: 'label'; id: string }
	| { kind: 'place'; key: string }
	| { kind: 'event'; id: string };

/** The fixed lists' names, which every client and the list catalog show. */
export const FIXED_NAMES = {
	inbox: 'Inbox',
	tomorrow: 'Tomorrow',
	'this-week': 'This week',
	'no-date': 'No date',
	completed: 'Completed',
} as const;
export type FixedScreen = keyof typeof FIXED_NAMES;

const FIXED = Object.keys(FIXED_NAMES) as FixedScreen[];
const PLURAL = { project: 'projects', label: 'labels', place: 'places', event: 'events' } as const;

/** The web app's path for `screen`. A section or a day only opens quick add, so the path leaves it out. */
export function screenPath(screen: Screen): string {
	switch (screen.kind) {
		case 'project':
		case 'label':
		case 'event':
			return `/${PLURAL[screen.kind]}/${encodeURIComponent(screen.id)}`;
		case 'place':
			return `/places/${encodeURIComponent(screen.key)}`;
		default:
			return `/${screen.kind}`;
	}
}

/** The screen a web app path shows, or null for a page that lists no tasks, such as a public link. */
export function screenOfPath(path: string): Screen | null {
	const [, first = '', second, ...rest] = path.split('/');
	if (second === undefined) return FIXED.includes(first as FixedScreen) ? { kind: first as FixedScreen } : null;
	if (!second || rest.length) return null;
	const id = decodeURIComponent(second);
	switch (first) {
		case 'projects':
			return { kind: 'project', id };
		case 'labels':
			return { kind: 'label', id };
		case 'places':
			return { kind: 'place', key: id };
		case 'events':
			return { kind: 'event', id };
		default:
			return null;
	}
}

/** The screen a list from the catalog opens. */
export function entryScreen({ kind, id }: Pick<ListEntry, 'kind' | 'id'>): Screen {
	switch (kind) {
		case 'project':
		case 'label':
		case 'event':
			return { kind, id };
		case 'place':
			return { kind, key: id };
		default:
			return { kind };
	}
}

/** Where a tapped notification opens the web app. A task opens its details over Inbox. */
export function notificationHref(opens: NotificationTarget | null): string {
	switch (opens?.kind) {
		case undefined:
		case 'inbox':
			return '/inbox';
		case 'task':
			return `/inbox?${TASK_PARAM}=${encodeURIComponent(opens.id)}`;
		case 'place':
			return screenPath({ kind: 'place', key: opens.id });
		case 'event':
		case 'project':
			return screenPath({ kind: opens.kind, id: opens.id });
	}
}

/** The query parameter that opens a task's details over the list. */
export const TASK_PARAM = 'task';

/** What quick add and Ramble start with. An event stands in for the date and the repeat. */
export type ListDefaults = {
	projectId: string | null;
	sectionId: string | null;
	labelIds: readonly string[];
	location: TaskLocation | null;
	event: TaskEvent | null;
	date: DateKey | null;
};

export const NO_DEFAULTS: ListDefaults = {
	projectId: null,
	sectionId: null,
	labelIds: [],
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
 * label, its place, its event, or the day of a day heading. Tomorrow starts tomorrow and This week today, the one day
 * the week always holds. Inbox itself adds an undated task, as capture always has, and so do No date, Completed, and a
 * shared project or label the user can't add to (`canAddTo`).
 */
export function screenDefaults(
	screen: Screen | null,
	tasks: readonly Task[],
	space: SharedSpace | null,
	today: DateKey,
): ListDefaults {
	if (!canAddTo(screen, space)) return NO_DEFAULTS;
	switch (screen?.kind) {
		case undefined:
		case 'no-date':
		case 'completed':
			return NO_DEFAULTS;
		case 'inbox':
			return { ...NO_DEFAULTS, date: screen.date ?? null };
		case 'tomorrow':
			return { ...NO_DEFAULTS, date: addDays(today, 1) };
		case 'this-week':
			return { ...NO_DEFAULTS, date: screen.date ?? today };
		case 'project':
			return { ...NO_DEFAULTS, projectId: screen.id, sectionId: screen.sectionId ?? null };
		case 'label':
			return { ...NO_DEFAULTS, labelIds: [screen.id] };
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

/**
 * What the next task starts with after quick add saves `task`, in the same sheet or a later one on the same screen:
 * where the task went (its project, section, labels, place, and event), never its own date or priority, which belong
 * to one task. `date` is the sheet's or screen's own, so a batch typed into Tomorrow stays in Tomorrow. A saved place
 * goes back among the labels, since quick add picks one there.
 */
export function reusedDefaults(task: Task, labels: readonly Label[], date: DateKey | null): ListDefaults {
	return {
		projectId: task.projectId,
		sectionId: task.sectionId,
		labelIds: pickedLabels(labels, task),
		location: task.location,
		event: task.event,
		date,
	};
}

/** Whether `task` shows on `screen`, so saving it from there keeps the screen open. */
export function screenHolds(screen: Screen | null, task: Task, today: DateKey, zone?: string): boolean {
	switch (screen?.kind) {
		case undefined:
		case 'completed':
			return false;
		case 'inbox':
			return scheduledDue(task, today, zone) !== null;
		case 'tomorrow':
			return scheduledDue(task, today, zone)?.date === addDays(today, 1);
		case 'this-week': {
			const day = scheduledDue(task, today, zone)?.date;
			return day !== undefined && day <= weekEnd(today);
		}
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

/**
 * The screen whose tasks `screen` lists: a saved place's label screen lists the tasks at the place, which never carry
 * the place as a label.
 */
export function listedScreen(screen: Screen | null, labels: readonly Label[]): Screen | null {
	const place = screen?.kind === 'label' ? labels.find(label => label.id === screen.id)?.place : null;
	return place ? { kind: 'place', key: placeKey(place) } : screen;
}

/**
 * Where a task just added on `screen` shows: null when `screen` itself shows it, else its project, else Inbox when it
 * has a day or No date when it has none.
 */
export function addedScreen(
	screen: Screen | null,
	task: Task,
	labels: readonly Label[],
	today: DateKey,
	zone?: string,
): Screen | null {
	if (screenHolds(listedScreen(screen, labels), task, today, zone)) return null;
	if (task.projectId) return { kind: 'project', id: task.projectId };
	return { kind: scheduledDue(task, today, zone) ? 'inbox' : 'no-date' };
}

/** How the toast after a save names the list `addedScreen` chose. */
export function addedName(screen: Screen, projects: readonly Project[]): string {
	if (screen.kind === 'project') return projects.find(project => project.id === screen.id)?.name ?? 'its project';
	return screen.kind in FIXED_NAMES ? FIXED_NAMES[screen.kind as FixedScreen] : 'its list';
}
