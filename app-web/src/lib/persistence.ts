import { z } from 'zod';
import type { DateKey, Project, Task, TimeOfDay } from 'shared/task.ts';

const STORAGE_KEY = 'procrastimate';

const dateKey = z.custom<DateKey>(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
const timeOfDay = z.custom<TimeOfDay>(v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v));

const taskSchema = z.object({
	id: z.string(),
	title: z.string(),
	notes: z.string(),
	projectId: z.string().nullable(),
	due: z.object({ date: dateKey, time: timeOfDay.nullable() }).nullable(),
	// Defaults instead of failing validation, so tasks stored before the field existed are kept.
	recurrence: z
		.object({ interval: z.number().int().positive(), unit: z.enum(['day', 'week', 'month', 'year']) })
		.nullable()
		.default(null),
	priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
	reminders: z.array(
		z.discriminatedUnion('kind', [
			z.object({ kind: z.literal('before'), minutes: z.number().int().nonnegative() }),
			z.object({ kind: z.literal('at'), date: dateKey, time: timeOfDay }),
		]),
	),
	createdAt: z.number(),
	completedAt: z.number().nullable(),
}) satisfies z.ZodType<Task>;

const projectSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.number(),
}) satisfies z.ZodType<Project>;

const snapshotSchema = z.object({
	tasks: z.array(taskSchema),
	projects: z.array(projectSchema),
	remindersCheckedAt: z.number(),
});

export type Snapshot = z.infer<typeof snapshotSchema>;

export function loadSnapshot(now: number): Snapshot {
	const empty: Snapshot = { tasks: [], projects: [], remindersCheckedAt: now };
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return empty;
	try {
		const parsed = snapshotSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : empty;
	} catch {
		return empty;
	}
}

export function saveSnapshot(snapshot: Snapshot) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}
