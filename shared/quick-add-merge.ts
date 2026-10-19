import type { Due, Priority, Recurrence } from './task.ts';
import type { TaskEvent } from './values.ts';

/** The fields a typed phrase can set over a picked or stored value. A stored task always has a priority; a ramble may not. */
export type Placed<P extends Priority | null = Priority | null> = {
	due: Due | null;
	recurrence: Recurrence | null;
	priority: P;
	projectId: string | null;
	sectionId: string | null;
};

export type Typed = Partial<Placed>;

/**
 * Typed values win over the base's, as quick add, task details, and a ramble all read a title. A typed project other
 * than the base's leaves the base's section behind, and an event stands in for the date and the repeat.
 */
export function typedOver<P extends Priority | null>(
	base: Placed<P>,
	typed: Typed,
	event: TaskEvent | null,
): Placed<P> {
	const projectId = typed.projectId ?? base.projectId;
	return {
		due: event ? null : (typed.due ?? base.due),
		recurrence: event ? null : (typed.recurrence ?? base.recurrence),
		priority: (typed.priority ?? base.priority) as P,
		projectId,
		sectionId: typed.sectionId ?? (projectId === base.projectId ? base.sectionId : null),
	};
}
