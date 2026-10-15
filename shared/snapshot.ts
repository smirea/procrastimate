import { z } from 'zod';
import { dictationChoiceSchema } from './dictation.ts';
import { sortTasks } from './store.ts';
import { detachOrphans } from './subtasks.ts';
import { hlcSchema } from './db/json.ts';
import {
	labelSchema,
	opSchema,
	projectSchema,
	shareTargetSchema,
	taskSchema as syncedTaskSchema,
} from './sync/protocol.ts';
import { personSchema } from './sharing.ts';
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
	location: syncedTaskSchema.shape.location.default(null),
	event: syncedTaskSchema.shape.event.default(null),
	createdBy: syncedTaskSchema.shape.createdBy.default(null),
	completedBy: syncedTaskSchema.shape.completedBy.default(null),
	lastCompletedAt: syncedTaskSchema.shape.lastCompletedAt.default(null),
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
const tasksSchema = z
	.array(z.unknown())
	// Swift holds the loaded tasks, which Core's decoder of the document drops one by one the same way.
	.meta({ 'x-swift-type': '[Task]' })
	.transform(items =>
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
 * to the synced settings, so it writes again only after it moves. `dictation` is the choice this device
 * last applied, including one that arrived from another device. `epoch` is the wipe generation it last applied.
 * `reset` is set until the server has wiped task data for a local delete-all.
 */
const syncSchema = z
	.object({
		deviceId: z.string(),
		cursor: z.number().int().nonnegative(),
		// Core diffs an op's fields as JSON values, so Swift keeps its own `SyncOp` for the outbox.
		outbox: z.array(opSchema.meta({ 'x-swift-type': 'SyncOp' })),
		clock: hlcSchema,
		timeZone: z.string(),
		dictation: dictationChoiceSchema.default('native'),
		epoch: z.number().int().nonnegative().default(0),
		reset: z.boolean().default(false),
	})
	.meta({ id: 'SyncSection' });

/**
 * A space someone shared with this user, kept apart from the user's own data and synced on its own: `cursor`,
 * `outbox`, and `epoch` work as in the sync section, `scope` is the hash of what the server last let it see, and
 * `readOnly` lists the visible tasks it may not edit, and `targets`
 * what the owner shared with this user. The device clock in the sync section serves every space.
 */
const spaceSectionSchema = z
	.object({
		owner: personSchema,
		cursor: syncSchema.shape.cursor,
		outbox: syncSchema.shape.outbox,
		epoch: z.number().int().nonnegative().default(0),
		scope: z.string().default(''),
		readOnly: z.array(z.string()).default([]),
		targets: z.array(shareTargetSchema).default([]),
		tasks: tasksSchema,
		projects: z.array(projectSchema).default([]),
		labels: z.array(labelSchema).default([]),
	})
	// Core decodes the section's tasks with the same loading rules, so it writes its own decoder.
	.meta({ id: 'SpaceSection', 'x-decode': 'custom' });

/** Drops a section that fails validation, so one bad shared space never wipes the document. The next sync refills it. */
const spacesSchema = z
	.record(z.string(), z.unknown())
	.default({})
	.meta({ 'x-swift-type': '[String: SpaceSection]' })
	.transform(sections =>
		Object.fromEntries(
			Object.entries(sections).flatMap(([owner, value]) => {
				const section = spaceSectionSchema.safeParse(value);
				return section.success ? [[owner, section.data] as const] : [];
			}),
		),
	);

const snapshotSchema = z
	.object({
		tasks: tasksSchema,
		projects: z.array(projectSchema),
		labels: z.array(labelSchema).default([]),
		remindersCheckedAt: z.number().int(),
		sync: syncSchema.optional(),
		/** Shared spaces by owner id. */
		spaces: spacesSchema,
		/** Everyone this device has seen named, so authorship shows offline. */
		people: z.array(personSchema).default([]),
	})
	// Core decodes tasks one by one with the loading rules above, so it writes its own decoder.
	.meta({ id: 'Snapshot', 'x-decode': 'custom' });

export type SyncSection = z.infer<typeof syncSchema>;
export type SpaceSection = z.infer<typeof spaceSectionSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

export const emptySnapshot = (now: number): Snapshot => ({
	tasks: [],
	projects: [],
	labels: [],
	remindersCheckedAt: now,
	spaces: {},
	people: [],
});

export function parseSnapshot(value: unknown, now: number): Snapshot {
	const parsed = snapshotSchema.safeParse(value);
	return parsed.success ? parsed.data : emptySnapshot(now);
}
