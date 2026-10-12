import { z } from 'zod';
import { isHlc } from './hlc.ts';
import type { Kind } from './kinds.ts';
import type { DateKey, Label, Project, Task, TimeOfDay, Weekday } from '../task.ts';

/**
 * The wire format of `POST /api/sync`. An op carries the new values of the fields one command changed
 * on one entity, plus `deleted` for a delete or an undelete. A change is a log row: the fields of one
 * op that won on the server, in server order.
 */

export { KINDS, type Kind } from './kinds.ts';

/** The id of the one settings record. */
export const SETTINGS_ID = 'settings';

export type Settings = { timeZone: string | null };
export const DEFAULT_SETTINGS: Settings = { timeZone: null };

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_OF_DAY_PATTERN = /^\d{2}:\d{2}$/;

/** Custom so the parsed type is the template literal. The contract gives both their JSON Schema. */
export const dateKeySchema = z.custom<DateKey>(v => typeof v === 'string' && DATE_KEY_PATTERN.test(v));
export const timeOfDaySchema = z.custom<TimeOfDay>(v => typeof v === 'string' && TIME_OF_DAY_PATTERN.test(v));
const dateKey = dateKeySchema;
const timeOfDay = timeOfDaySchema;
const interval = z.number().int().positive();
const weekday = z.literal([0, 1, 2, 3, 4, 5, 6]) satisfies z.ZodType<Weekday>;

export const recurrenceSchema = z.discriminatedUnion('unit', [
	z.object({ interval, unit: z.enum(['day', 'weekday', 'month', 'year']) }),
	z.object({ interval, unit: z.literal('week'), days: z.array(weekday).min(2).readonly().optional() }),
]);

export const reminderSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('before'), minutes: z.number().int().nonnegative() }),
	z.object({ kind: z.literal('at'), date: dateKey, time: timeOfDay }),
]);

export const dueSchema = z.object({ date: dateKey, time: timeOfDay.nullable() });

/** Every synced field of each kind. A missing `sourceKey` travels as `null`, since JSON has no `undefined`. */
export const taskFieldsSchema = z.object({
	parentId: z.string().nullable(),
	order: z.number(),
	title: z.string(),
	notes: z.string(),
	projectId: z.string().nullable(),
	labelIds: z.array(z.string()),
	due: dueSchema.nullable(),
	recurrence: recurrenceSchema.nullable(),
	priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
	reminders: z.array(reminderSchema),
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

/** A missing `sourceKey` stays missing in a whole entity, since JSON has no `undefined`. */
export const taskSchema = taskFieldsSchema.extend({
	id: z.string(),
	sourceKey: z.string().optional(),
}) satisfies z.ZodType<Task>;

export const projectSchema = projectFieldsSchema.extend({
	id: z.string(),
	sourceKey: z.string().optional(),
}) satisfies z.ZodType<Project>;

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

export const PATCH_SCHEMAS = {
	task: patchOf('task'),
	project: patchOf('project'),
	label: patchOf('label'),
	settings: patchOf('settings'),
} as const;

/** One entity's changed fields, before it gets an op id and a clock. */
export const patchSchema = z.discriminatedUnion('kind', [
	PATCH_SCHEMAS.task,
	PATCH_SCHEMAS.project,
	PATCH_SCHEMAS.label,
	PATCH_SCHEMAS.settings,
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

/** The most log rows one response carries. A client that gets a full page syncs again right away. */
export const SYNC_PAGE_SIZE = 1000;

export const syncRequestSchema = z.object({
	cursor,
	ops: z.array(opSchema),
	/** The wipe generation this client last applied. A lower one means its copy was cleared on another device. */
	epoch: z.number().int().nonnegative().default(0),
	/** Wipe task data before applying `ops`, then bump the epoch. */
	reset: z.boolean().optional(),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

const epoch = z.number().int().nonnegative();

/** Cursor `0`, a cursor past the log, a reset, or a stale epoch gets the whole snapshot instead of the log. */
export const syncResponseSchema = z.union([
	z.object({ acked: z.array(z.string()), changes: z.array(changeSchema), cursor, hlc, epoch }),
	z.object({ acked: z.array(z.string()), snapshot: snapshotSchema, cursor, hlc, epoch }),
]);
export type SyncResponse = z.infer<typeof syncResponseSchema>;

/**
 * The realtime nudge: a WebSocket on which the server sends `{ cursor }` after every push that moved the log. It
 * only says "sync now"; the changes still come through `POST /api/sync`. The session travels as a cookie in the
 * browser and as `Authorization: Bearer` from iOS. Browsers cannot set headers on a WebSocket, so the web also
 * sends `device.<id>` as a subprotocol next to `SYNC_SOCKET_PROTOCOL`, which the server echoes.
 */
export const SYNC_SOCKET_PATH = '/api/sync/socket';
export const SYNC_SOCKET_PROTOCOL = 'procrastimate.sync';
export const DEVICE_PROTOCOL_PREFIX = 'device.';
/** Answered by the server without waking the Durable Object, so a keepalive costs nothing. */
export const SOCKET_PING = 'ping';
export const SOCKET_PONG = 'pong';
/** The close code the server uses when the socket's device is removed. */
export const SOCKET_REVOKED = 4401;

export const nudgeSchema = z.object({ cursor });
export type Nudge = z.infer<typeof nudgeSchema>;

const asNumber = (value: unknown) => (typeof value === 'boolean' ? Number(value) : value);

/**
 * iOS builds up to 2026.1011.235500 read every JSON 0 and 1 back as a boolean when they built an op, so a field
 * such as `order: 0` or `priority: 1` went out as `false` or `true`, and the push failed validation. Only 0 and 1
 * were turned into booleans, so turning them back is exact. Their stored outboxes still hold those ops.
 */
export function repairBooleanNumbers(body: unknown): unknown {
	if (!body || typeof body !== 'object' || !Array.isArray((body as { ops?: unknown }).ops)) return body;
	const ops = (body as { ops: unknown[] }).ops.map(op => {
		if (!op || typeof op !== 'object') return op;
		const { kind, fields } = op as { kind?: unknown; fields?: Record<string, unknown> };
		if (!fields || typeof fields !== 'object' || kind === 'settings') return op;
		const next: Record<string, unknown> = { ...fields };
		for (const name of ['order', 'createdAt', 'completedAt', 'priority']) {
			if (name in next) next[name] = asNumber(next[name]);
		}
		if (kind === 'task') {
			const recurrence = next.recurrence as Record<string, unknown> | null | undefined;
			if (recurrence && typeof recurrence === 'object') {
				next.recurrence = {
					...recurrence,
					interval: asNumber(recurrence.interval),
					...(Array.isArray(recurrence.days) ? { days: recurrence.days.map(asNumber) } : {}),
				};
			}
			if (Array.isArray(next.reminders)) {
				next.reminders = next.reminders.map(reminder =>
					reminder && typeof reminder === 'object' && 'minutes' in reminder
						? { ...reminder, minutes: asNumber((reminder as { minutes: unknown }).minutes) }
						: reminder,
				);
			}
		}
		return { ...op, fields: next };
	});
	return { ...body, ops };
}
