import { priorityLabel } from 'shared/format.ts';
import type { Priority } from 'shared/task.ts';

export const PRIORITIES: Record<Priority, { label: string; tone: string }> = {
	1: { label: priorityLabel(1), tone: 'var(--p1)' },
	2: { label: priorityLabel(2), tone: 'var(--p2)' },
	3: { label: priorityLabel(3), tone: 'var(--p3)' },
	4: { label: priorityLabel(4), tone: 'var(--p4)' },
};
