import { z } from 'zod';
import { sortTasks, type StoreData } from './store.ts';
import { detachOrphans } from './subtasks.ts';
import { weeklyOn, type DateKey, type Label, type Project, type Task, type TimeOfDay, type Weekday } from './task.ts';

/**
 * The one stored document: the web's `procrastimate` localStorage value and the iOS app's JSON file. Loading drops
 * an invalid task on its own, defaults fields added later, and discards an invalid document, with no migrations.
 */

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
	sortTasks(
		detachOrphans(
			items.flatMap(item => {
				const task = taskSchema.safeParse(item);
				return task.success ? [task.data] : [];
			}),
		),
	),
);

/** A change waiting to sync, as `docs/decisions/sync.md` describes it. `fields` holds the changed fields' new values. */
const opSchema = z.object({
	opId: z.string(),
	hlc: z.string(),
	kind: z.enum(['task', 'project', 'label', 'settings']),
	id: z.string(),
	fields: z.record(z.string(), z.unknown()),
});

/** Device-local sync state. A device without it is unpaired and keeps no outbox. */
const syncSchema = z.object({
	deviceId: z.string(),
	cursor: z.number().int().nonnegative(),
	outbox: z.array(opSchema),
});

const snapshotSchema = z.object({
	tasks: tasksSchema,
	projects: z.array(projectSchema),
	labels: z.array(labelSchema).default([]),
	remindersCheckedAt: z.number(),
	sync: syncSchema.optional(),
});

export type SyncOp = z.infer<typeof opSchema>;
export type SyncSection = z.infer<typeof syncSchema>;
export type Snapshot = StoreData & { remindersCheckedAt: number; sync?: SyncSection };

export const emptySnapshot = (now: number): Snapshot => ({
	tasks: [],
	projects: [],
	labels: [],
	remindersCheckedAt: now,
});

/** Reads a stored document, or starts empty when it is missing or invalid. */
export function parseSnapshot(value: unknown, now: number): Snapshot {
	const parsed = snapshotSchema.safeParse(value);
	return parsed.success ? parsed.data : emptySnapshot(now);
}
