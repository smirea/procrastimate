import { z } from 'zod';
import { detachOrphans } from 'shared/subtasks.ts';
import {
	weeklyOn,
	type DateKey,
	type Label,
	type Project,
	type Task,
	type TimeOfDay,
	type Weekday,
} from 'shared/task.ts';

const STORAGE_KEY = 'procrastimate';

const dateKey = z.custom<DateKey>(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
const timeOfDay = z.custom<TimeOfDay>(v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v));
const interval = z.number().int().positive();
const weekdays = z
	.array(z.custom<Weekday>(v => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6))
	.min(1);

const taskSchema = z.object({
	id: z.string(),
	parentId: z.string().nullable().default(null),
	order: z.number().default(0),
	title: z.string(),
	notes: z.string(),
	projectId: z.string().nullable(),
	// Fields added after launch default instead of failing validation, so tasks stored before them are kept.
	labelIds: z.array(z.string()).default([]),
	due: z.object({ date: dateKey, time: timeOfDay.nullable() }).nullable(),
	recurrence: z
		.discriminatedUnion('unit', [
			z.object({ interval, unit: z.enum(['day', 'weekday', 'month', 'year']) }),
			z
				.object({ interval, unit: z.literal('week'), days: weekdays.optional() })
				.transform(({ interval, days }) => weeklyOn(interval, days ?? [])),
		])
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
	sourceKey: z.string().optional(),
}) satisfies z.ZodType<Task>;

const labelSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.number(),
}) satisfies z.ZodType<Label>;

const projectSchema = labelSchema.extend({ sourceKey: z.string().optional() }) satisfies z.ZodType<Project>;

/** Drops a task that fails validation instead of failing the whole snapshot, so one bad task never wipes the rest. */
const tasksSchema = z.array(z.unknown()).transform(items =>
	detachOrphans(
		items.flatMap(item => {
			const task = taskSchema.safeParse(item);
			return task.success ? [task.data] : [];
		}),
	),
);

const snapshotSchema = z.object({
	tasks: tasksSchema,
	projects: z.array(projectSchema),
	labels: z.array(labelSchema).default([]),
	remindersCheckedAt: z.number(),
});

export type Snapshot = z.infer<typeof snapshotSchema>;

export function loadSnapshot(now: number): Snapshot {
	const empty: Snapshot = { tasks: [], projects: [], labels: [], remindersCheckedAt: now };
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
