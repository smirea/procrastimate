import { z } from 'zod';
import { isHlc } from './hlc.ts';
import type { DateKey, Label, Project, Task, TimeOfDay, Weekday } from '../task.ts';

/**
 * The wire format of `POST /api/sync`. An op carries the new values of the fields one command changed
 * on one entity, plus `deleted` for a delete or an undelete. A change is a log row: the fields of one
 * op that won on the server, in server order.
 */

export const KINDS = ['project', 'label', 'task', 'settings'] as const;
export type Kind = (typeof KINDS)[number];

/** The id of the one settings record. */
export const SETTINGS_ID = 'settings';

export type Settings = { timeZone: string | null };
export const DEFAULT_SETTINGS: Settings = { timeZone: null };

const dateKey = z.custom<DateKey>(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
const timeOfDay = z.custom<TimeOfDay>(v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v));
const interval = z.number().int().positive();
const weekday = z.custom<Weekday>(v => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6);

const recurrence = z.discriminatedUnion('unit', [
	z.object({ interval, unit: z.enum(['day', 'weekday', 'month', 'year']) }),
	z.object({ interval, unit: z.literal('week'), days: z.array(weekday).min(2).readonly().optional() }),
]);

const reminder = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('before'), minutes: z.number().int().nonnegative() }),
	z.object({ kind: z.literal('at'), date: dateKey, time: timeOfDay }),
]);

/** Every synced field of each kind. A missing `sourceKey` travels as `null`, since JSON has no `undefined`. */
export const taskFieldsSchema = z.object({
	parentId: z.string().nullable(),
	order: z.number(),
	title: z.string(),
	notes: z.string(),
	projectId: z.string().nullable(),
	labelIds: z.array(z.string()),
	due: z.object({ date: dateKey, time: timeOfDay.nullable() }).nullable(),
	recurrence: recurrence.nullable(),
	priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
	reminders: z.array(reminder),
	createdAt: z.number(),
	completedAt: z.number().nullable(),
	sourceKey: z.string().nullable(),
});

export const projectFieldsSchema = z.object({
	name: z.string(),
	createdAt: z.number(),
	sourceKey: z.string().nullable(),
});

export const labelFieldsSchema = z.object({ name: z.string(), createdAt: z.number() });

export const settingsFieldsSchema = z.object({ timeZone: z.string().nullable() });

export const FIELDS_SCHEMAS = {
	task: taskFieldsSchema,
	project: projectFieldsSchema,
	label: labelFieldsSchema,
	settings: settingsFieldsSchema,
} as const satisfies Record<Kind, z.ZodObject>;

export type FieldsByKind = { [K in Kind]: z.infer<(typeof FIELDS_SCHEMAS)[K]> };

export const taskSchema = taskFieldsSchema
	.extend({ id: z.string(), sourceKey: z.string().optional() })
	.transform(({ sourceKey, ...task }) => (sourceKey === undefined ? task : { ...task, sourceKey })) satisfies z.ZodType<
	Task,
	unknown
>;

export const projectSchema = projectFieldsSchema
	.extend({ id: z.string(), sourceKey: z.string().optional() })
	.transform(({ sourceKey, ...project }) =>
		sourceKey === undefined ? project : { ...project, sourceKey },
	) satisfies z.ZodType<Project, unknown>;

export const labelSchema = labelFieldsSchema.extend({ id: z.string() }) satisfies z.ZodType<Label>;

export const settingsSchema = settingsFieldsSchema satisfies z.ZodType<Settings>;

/** Everything that syncs. Device-local state such as the theme or `remindersCheckedAt` stays out. */
export const snapshotSchema = z.object({
	tasks: z.array(taskSchema),
	projects: z.array(projectSchema),
	labels: z.array(labelSchema),
	settings: settingsSchema,
});

export type Snapshot = { tasks: Task[]; projects: Project[]; labels: Label[]; settings: Settings };

const patchOf = <K extends Kind>(kind: K) =>
	z.object({
		kind: z.literal(kind),
		id: z.string(),
		fields: FIELDS_SCHEMAS[kind].partial().extend({ deleted: z.boolean().optional() }),
	});

/** One entity's changed fields, before it gets an op id and a clock. */
export const patchSchema = z.discriminatedUnion('kind', [
	patchOf('task'),
	patchOf('project'),
	patchOf('label'),
	patchOf('settings'),
]);
export type Patch = z.infer<typeof patchSchema>;

const hlc = z.string().refine(isHlc, 'Invalid HLC');

export const opSchema = z.intersection(patchSchema, z.object({ opId: z.string(), hlc }));
export type Op = z.infer<typeof opSchema>;

export const changeSchema = z.intersection(
	patchSchema,
	z.object({ seq: z.number().int().positive(), opId: z.string() }),
);
export type Change = z.infer<typeof changeSchema>;

const cursor = z.number().int().nonnegative();

export const syncRequestSchema = z.object({ cursor, ops: z.array(opSchema) });
export type SyncRequest = z.infer<typeof syncRequestSchema>;

/** Cursor `0` gets the whole snapshot instead of the log. */
export const syncResponseSchema = z.union([
	z.object({ acked: z.array(z.string()), changes: z.array(changeSchema), cursor, hlc }),
	z.object({ acked: z.array(z.string()), snapshot: snapshotSchema, cursor, hlc }),
]);
export type SyncResponse = z.infer<typeof syncResponseSchema>;
