import { z } from 'zod';
import { sortTasks, type StoreData } from './store.ts';
import { detachOrphans } from './subtasks.ts';
import { isHlc } from './sync/hlc.ts';
import { labelSchema, opSchema, projectSchema, taskSchema as syncedTaskSchema } from './sync/protocol.ts';
import { weeklyOn } from './task.ts';
import { recurrenceSchema, weekdaySchema } from './values.ts';

/**
 * The one stored document: the web's `procrastimate` localStorage value and the iOS app's JSON file. Loading drops
 * an invalid task on its own, defaults fields added later, and discards an invalid document, with no migrations.
 */

const interval = z.number().int().positive();

/**
 * The synced task, with the loading rules of the stored document: fields added after launch default instead of
 * failing validation, so tasks stored before them are kept, and a weekly repeat stored with one day is normalized.
 */
const taskSchema = syncedTaskSchema.extend({
	parentId: syncedTaskSchema.shape.parentId.default(null),
	order: syncedTaskSchema.shape.order.default(0),
	labelIds: syncedTaskSchema.shape.labelIds.default([]),
	recurrence: z
		.discriminatedUnion('unit', [
			recurrenceSchema.options[0],
			z
				.object({ interval, unit: z.literal('week'), days: z.array(weekdaySchema).min(1).optional() })
				.transform(({ interval, days }) => weeklyOn(interval, days ?? [])),
		])
		.nullable()
		.default(null),
});

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

/**
 * Device-local sync state. `clock` is the last clock the device issued or saw, and `timeZone` the zone it last wrote
 * to the synced settings, so it writes again only after it moves. `epoch` is the wipe generation it last applied.
 * `reset` is set until the server has wiped task data for a local delete-all.
 */
const syncSchema = z.object({
	deviceId: z.string(),
	cursor: z.number().int().nonnegative(),
	outbox: z.array(opSchema),
	clock: z.string().refine(isHlc),
	timeZone: z.string(),
	epoch: z.number().int().nonnegative().default(0),
	reset: z.boolean().default(false),
});

const snapshotSchema = z.object({
	tasks: tasksSchema,
	projects: z.array(projectSchema),
	labels: z.array(labelSchema).default([]),
	remindersCheckedAt: z.number(),
	sync: syncSchema.optional(),
});

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
