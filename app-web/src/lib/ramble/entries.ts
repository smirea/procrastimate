import type { RambleTask } from 'shared/ramble.ts';

/** A spoken task in the drawer. Its key survives reparsing and the move from live to reviewed, so rows never remount. */
export type RambleEntry = Omit<RambleTask, 'segment' | 'subtasks'> & {
	key: string;
	subtasks: RambleEntry[];
	/** A place picked in the drawer, which wins over the spoken project and the list defaults, Inbox included. */
	place?: { projectId: string | null; sectionId: string | null };
};

/**
 * Keys a parse. The grammar reparses the whole transcript on each update and a ramble only grows at its end, so the
 * task at a given position is the same task from one update to the next.
 */
export function keyed(tasks: readonly RambleTask[], base: number): RambleEntry[] {
	const entry = ({ segment: _, subtasks, ...task }: RambleTask, key: string): RambleEntry => ({
		...task,
		key,
		subtasks: subtasks.map((subtask, i) => entry(subtask, `${key}.${i}`)),
	});
	return tasks.map((task, i) => entry(task, String(base + i)));
}
