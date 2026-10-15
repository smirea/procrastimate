import { z } from 'zod';
import {
	labelsRowSchema,
	logRowSchema,
	projectsRowSchema,
	sectionsRowSchema,
	settingsRowSchema,
	tasksRowSchema,
} from '../db/generated/zod.ts';
import { hlcSchema } from '../db/json.ts';
import { KINDS, type Kind } from './kinds.ts';
import { shareTargetKindSchema } from '../values.ts';
import { DEFAULT_QUICK_ADD_BUTTONS } from '../quick-add-buttons.ts';

export { KINDS, type Kind } from './kinds.ts';

export const kindSchema = z.enum(KINDS).meta({ id: 'EntityKind' });

export const SETTINGS_ID = 'settings';

/**
 * Each kind's synced fields are its table's columns, without the user, the id, the per-field clocks, and `deleted`,
 * which ops carry on their own. JSON columns get the shape of the value they hold. A missing `sourceKey` travels as
 * `null`, since JSON has no `undefined`.
 */
const NOT_FIELDS = { userId: true, id: true, deleted: true, clocks: true } as const;

export const taskFieldsSchema = tasksRowSchema.omit(NOT_FIELDS);
export const projectFieldsSchema = projectsRowSchema.omit(NOT_FIELDS);
export const sectionFieldsSchema = sectionsRowSchema.omit(NOT_FIELDS);
export const labelFieldsSchema = labelsRowSchema.omit(NOT_FIELDS);
export const settingsFieldsSchema = settingsRowSchema.omit({ userId: true, id: true, clocks: true });

export type Settings = z.infer<typeof settingsFieldsSchema>;
export const DEFAULT_SETTINGS: Settings = {
	timeZone: null,
	dictation: 'native',
	quickAddButtons: DEFAULT_QUICK_ADD_BUTTONS,
};

export const FIELDS_SCHEMAS = {
	task: taskFieldsSchema,
	project: projectFieldsSchema,
	section: sectionFieldsSchema,
	label: labelFieldsSchema,
	settings: settingsFieldsSchema,
} as const satisfies Record<Kind, z.ZodObject>;

export type FieldsByKind = { [K in Kind]: z.infer<(typeof FIELDS_SCHEMAS)[K]> };

/** A whole entity as clients hold it: a live row's fields and its id. A missing `sourceKey` stays missing. */
const ENTITY = { userId: true, deleted: true, clocks: true } as const;
export const taskSchema = tasksRowSchema
	.omit({ ...ENTITY, sourceKey: true })
	.extend({ sourceKey: z.string().optional() })
	.meta({ id: 'Task', 'x-table': 'tasks' });
export const projectSchema = projectsRowSchema
	.omit({ ...ENTITY, sourceKey: true })
	.extend({ sourceKey: z.string().optional() })
	.meta({ id: 'Project', 'x-table': 'projects' });
export const sectionSchema = sectionsRowSchema
	.omit({ ...ENTITY, sourceKey: true })
	.extend({ sourceKey: z.string().optional() })
	.meta({ id: 'ProjectSection', 'x-table': 'sections' });
export const labelSchema = labelsRowSchema.omit(ENTITY).meta({ id: 'Label', 'x-table': 'labels' });
export const settingsSchema = settingsFieldsSchema.meta({ id: 'Settings', 'x-table': 'settings' });

export type Task = z.infer<typeof taskSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Label = z.infer<typeof labelSchema>;

/** Everything that syncs. Device-local state such as the theme or `remindersCheckedAt` stays out. */
export const snapshotSchema = z
	.object({
		tasks: z.array(taskSchema),
		projects: z.array(projectSchema),
		sections: z.array(sectionSchema),
		labels: z.array(labelSchema),
		settings: settingsSchema,
	})
	.meta({ id: 'SyncSnapshot' });

export type Snapshot = z.infer<typeof snapshotSchema>;

const patchOf = <K extends Kind>(kind: K, id: string) =>
	z
		.object({
			kind: z.literal(kind),
			id: z.string(),
			fields: FIELDS_SCHEMAS[kind].partial().extend({ deleted: tasksRowSchema.shape.deleted.optional() }),
		})
		.meta({ id });

export const PATCH_SCHEMAS = {
	task: patchOf('task', 'TaskPatch'),
	project: patchOf('project', 'ProjectPatch'),
	section: patchOf('section', 'SectionPatch'),
	label: patchOf('label', 'LabelPatch'),
	settings: patchOf('settings', 'SettingsPatch'),
} as const;

export const patchSchema = z.discriminatedUnion('kind', [
	PATCH_SCHEMAS.task,
	PATCH_SCHEMAS.project,
	PATCH_SCHEMAS.section,
	PATCH_SCHEMAS.label,
	PATCH_SCHEMAS.settings,
]);
export type Patch = z.infer<typeof patchSchema>;

const hlc = hlcSchema;

export const opSchema = z.intersection(patchSchema, z.object({ opId: z.string(), hlc })).meta({ id: 'Op' });
export type Op = z.infer<typeof opSchema>;

export const changeSchema = z
	.intersection(patchSchema, logRowSchema.pick({ opId: true }).extend({ seq: logRowSchema.shape.seq.positive() }))
	.meta({ id: 'Change' });
export type Change = z.infer<typeof changeSchema>;

const cursor = z.number().int().nonnegative();

/** The most log rows one response carries. A client that gets a full page syncs again right away. */
export const SYNC_PAGE_SIZE = 1000;

export const syncRequestSchema = z
	.object({
		cursor,
		ops: z.array(opSchema),
		/** The wipe generation this client last applied. A lower one means its copy was cleared on another device. */
		epoch: z.number().int().nonnegative().default(0),
		reset: z.boolean().optional(),
		/** In a shared space, the hash of the filtered snapshot this client last applied. Owners send `''`. */
		scope: z.string().default(''),
	})
	.meta({ id: 'SyncRequest' });
export type SyncRequest = z.infer<typeof syncRequestSchema>;

const epoch = z.number().int().nonnegative();

export const shareTargetSchema = z
	.object({ kind: shareTargetKindSchema, id: z.string() })
	.meta({ id: 'ShareTarget', description: 'What a share reaches. `id` is empty for the whole space.' });
export type ShareTarget = z.infer<typeof shareTargetSchema>;

/** A guest's sync of a shared space answers with the hash of what it may see. An owner's sync has none. */
const scope = z.string().optional();

/** Cursor `0`, a cursor past the log, a reset, or a stale epoch gets the whole snapshot instead of the log. */
export const syncResponseSchema = z
	.union([
		z.object({ acked: z.array(z.string()), changes: z.array(changeSchema), cursor, hlc, epoch, scope }),
		z.object({
			acked: z.array(z.string()),
			snapshot: snapshotSchema,
			cursor,
			hlc,
			epoch,
			scope,
			/** In a shared space, the visible task ids the caller may not edit. */
			readOnly: z.array(z.string()).optional(),
			/** In a shared space, what the owner shared with the caller. */
			targets: z.array(shareTargetSchema).optional(),
		}),
	])
	.meta({ id: 'SyncResponse' });
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

/** `space` names the shared space that moved, by its owner's id. Without it the nudge is for the user's own space. */
export const nudgeSchema = z.object({ cursor, space: z.string().optional() }).meta({ id: 'Nudge' });
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
