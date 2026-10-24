import {
	bigint,
	bigserial,
	customType,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { IMAGE_SIZES, IMAGE_TYPES } from '../images.ts';
import { DICTATION_CHOICES, RAMBLE_MODES } from '../dictation.ts';
import { DEFAULT_QUICK_ADD_BUTTONS } from '../quick-add-buttons.ts';
import { KINDS } from '../kinds.ts';
import { LABEL_COLORS } from '../label-colors.ts';
import { PROJECT_ICONS } from '../project-icons.ts';
import { DEFAULT_PRIORITY, ROLES, SERVER_ACTOR, SHARE_TARGET_KINDS } from '../values.ts';
import type { ColumnValue } from './json.ts';

/**
 * The server's Postgres database. Every synced row keeps `user_id`, the owner of the space it lives in. PowerSync
 * replicates the synced tables (`SYNCED_TABLES`) to the devices that may see them; the rest never leave the server.
 * Column defaults are the domain's, which new entities and the generated Swift initializers start from.
 */

const millis = (name: string) => bigint(name, { mode: 'number' });

export const tasks = pgTable(
	'tasks',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		/** The task this one is a subtask of. A subtask shares its root task's project. */
		parentId: text('parent_id'),
		order: doublePrecision('order').notNull().default(0),
		title: text('title').notNull(),
		notes: text('notes').notNull().default(''),
		projectId: text('project_id'),
		/** A section of the task's project. Subtasks never have one. */
		sectionId: text('section_id'),
		labelIds: jsonb('label_ids').$type<ColumnValue<'tasks', 'labelIds'>>().notNull().default([]),
		due: jsonb('due').$type<ColumnValue<'tasks', 'due'>>(),
		recurrence: jsonb('recurrence').$type<ColumnValue<'tasks', 'recurrence'>>(),
		priority: integer('priority').$type<ColumnValue<'tasks', 'priority'>>().notNull().default(DEFAULT_PRIORITY),
		reminders: jsonb('reminders').$type<ColumnValue<'tasks', 'reminders'>>().notNull().default([]),
		/** Set only on iOS. A task with a location gets no notification at its due time; the place is its nudge. */
		location: jsonb('location').$type<ColumnValue<'tasks', 'location'>>(),
		/** Set only on iOS. A task with an event has no due date or repeat; the event's times stand in for both. */
		event: jsonb('event').$type<ColumnValue<'tasks', 'event'>>(),
		/** Attached images, as one last-writer-wins list like `labelIds`. The bytes are in `images`, never here. */
		images: jsonb('images').$type<ColumnValue<'tasks', 'images'>>().notNull().default([]),
		createdAt: millis('created_at').notNull(),
		completedAt: millis('completed_at'),
		/** Who created the task and who completed it last. The server stamps both and overwrites what a client sends. */
		createdBy: text('created_by'),
		completedBy: text('completed_by'),
		/** Every completion sets it, a recurring roll included, so a roll reads differently from a postpone. */
		lastCompletedAt: millis('last_completed_at'),
		/** Where an imported task came from, such as `todoist:task:…`, so importing the same backup again skips it. */
		sourceKey: text('source_key'),
	},
	table => [
		// Leads with the owner for every space read, and ends with the creation time so the newest is one probe.
		index('tasks_user_created').on(table.userId, table.createdAt),
		// Path ops, so the image route finds the tasks that list an image (`images @> [{ id }]`) without a scan.
		index('tasks_images').using('gin', table.images.op('jsonb_path_ops')),
		// Pattern ops, so a memo's tasks are a `LIKE 'voicememo:<memoId>:%'` range scan.
		index('tasks_source_key').on(table.userId, table.sourceKey.op('text_pattern_ops')),
	],
).enableRLS();

export const projects = pgTable(
	'projects',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		name: text('name').notNull(),
		/** Fractional, like sections. Ties sort by `createdAt`. */
		order: doublePrecision('order').notNull().default(0),
		/** Null shows the plain `#`. */
		icon: text('icon', { enum: PROJECT_ICONS }).$type<ColumnValue<'projects', 'icon'>>(),
		createdAt: millis('created_at').notNull(),
		sourceKey: text('source_key'),
	},
	table => [index('projects_user_id').on(table.userId)],
).enableRLS();

/** A heading inside one project that groups its top-level tasks, in `order` (fractional, like subtasks). */
export const sections = pgTable(
	'sections',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		projectId: text('project_id').notNull(),
		name: text('name').notNull(),
		order: doublePrecision('order').notNull().default(0),
		createdAt: millis('created_at').notNull(),
		sourceKey: text('source_key'),
	},
	table => [index('sections_user_id').on(table.userId)],
).enableRLS();

export const labels = pgTable(
	'labels',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		name: text('name').notNull(),
		color: text('color', { enum: LABEL_COLORS }).$type<ColumnValue<'labels', 'color'>>().notNull().default('gray'),
		/** Set when the label is a saved place, such as `Home`. Its tasks are the open tasks at the place. */
		place: jsonb('place').$type<ColumnValue<'labels', 'place'>>(),
		createdAt: millis('created_at').notNull(),
	},
	table => [index('labels_user_id').on(table.userId)],
).enableRLS();

/**
 * A comment on a task, in the task's space. The server stamps `authorId` and refuses an edit or a delete from anyone
 * but the author. A comment outlives its deleted task, so undoing the delete brings it back.
 */
export const comments = pgTable(
	'comments',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		taskId: text('task_id').notNull(),
		body: text('body').notNull(),
		authorId: text('author_id'),
		createdAt: millis('created_at').notNull(),
		editedAt: millis('edited_at'),
	},
	table => [index('comments_user_id').on(table.userId), index('comments_task_id').on(table.taskId)],
).enableRLS();

/**
 * When this user last read a task's comments, keyed by the task's id. It lives in the reader's own space, also for a
 * task in a space shared with them, so each user keeps their own read state and only the reader syncs it.
 */
export const reads = pgTable(
	'reads',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		readAt: millis('read_at').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.id] })],
).enableRLS();

/** The one settings record per user, whose id is always `settings`. It cannot be deleted. */
export const settings = pgTable(
	'settings',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		/** IANA name. The server needs it to compute notification times. */
		timeZone: text('time_zone'),
		/** `native` or `elevenlabs`. Offline sessions still use native. */
		dictation: text('dictation', { enum: DICTATION_CHOICES })
			.$type<ColumnValue<'settings', 'dictation'>>()
			.notNull()
			.default('native'),
		/** How Ramble reads speech: `smart` (Gemini) or `commands` (spoken cues only). Toggled in the Ramble drawer. */
		rambleMode: text('ramble_mode', { enum: RAMBLE_MODES })
			.$type<ColumnValue<'settings', 'rambleMode'>>()
			.notNull()
			.default('smart'),
		/** The quick add buttons pinned to the chip row, in row order. The `+` menu lists the rest. */
		quickAddButtons: jsonb('quick_add_buttons')
			.$type<ColumnValue<'settings', 'quickAddButtons'>>()
			.notNull()
			.default(DEFAULT_QUICK_ADD_BUTTONS),
	},
	table => [primaryKey({ columns: [table.userId, table.id] })],
).enableRLS();

/**
 * What a guest may see in another user's space, one row per entity, recomputed by the server from the owner's
 * shares with `scopeOf`. PowerSync streams a guest exactly the rows these name, and `role` says which they may edit.
 */
export const access = pgTable(
	'access',
	{
		/** `<grantee>:<kind>:<entityId>`. */
		id: text('id').primaryKey(),
		grantee: text('grantee').notNull(),
		owner: text('owner').notNull(),
		kind: text('kind', { enum: ['task', 'project', 'section', 'label'] }).notNull(),
		entityId: text('entity_id').notNull(),
		role: text('role', { enum: ROLES }).$type<ColumnValue<'access', 'role'>>().notNull(),
	},
	table => [index('access_grantee').on(table.grantee), index('access_owner').on(table.owner)],
).enableRLS();

export const ENTITY_TABLES = {
	task: tasks,
	project: projects,
	section: sections,
	label: labels,
	comment: comments,
	read: reads,
	settings,
} as const;

/** The tables PowerSync replicates, in the publication and in every client's local database. */
export const SYNCED_TABLES = { ...ENTITY_TABLES, access } as const;

/**
 * Every write the server applied, for activity and for the apps behind a task: the fields it set, who sent it, the
 * app it came from, and when. `op_id` is the client's id for the write, unique per space, so a retried batch inserts
 * no second row. Clients never read it.
 */
export const log = pgTable(
	'log',
	{
		seq: bigserial('seq', { mode: 'number' }).primaryKey(),
		userId: text('user_id').notNull(),
		opId: text('op_id'),
		kind: text('kind', { enum: KINDS }).notNull(),
		id: text('id').notNull(),
		op: text('op', { enum: ['put', 'patch', 'delete'] }).notNull(),
		fields: jsonb('fields').$type<ColumnValue<'log', 'fields'>>().notNull(),
		actor: text('actor').notNull().default(SERVER_ACTOR),
		/** Null for rows from before the server recorded apps. */
		client: jsonb('client').$type<ColumnValue<'log', 'client'>>(),
		at: millis('at').notNull(),
	},
	table => [
		// In write order, so a task's first and latest rows are each one probe and its activity needs no sort. Ids are
		// unique across spaces, so it also finds which space last held a row that is gone.
		index('log_entity').on(table.kind, table.id, table.seq),
		uniqueIndex('log_op').on(table.userId, table.opId),
		// Every source key a task held, deleted tasks' included, so a memo's re-sent task is found without a scan.
		index('log_source_key')
			.on(table.userId, sql`(${table.fields}->>'sourceKey')`)
			.where(sql`${table.kind} = 'task' and ${table.fields} ? 'sourceKey'`),
		// A task's comments, for its activity.
		index('log_comment_task')
			.on(table.userId, sql`(${table.fields}->>'taskId')`)
			.where(sql`${table.kind} = 'comment' and ${table.op} = 'put'`),
	],
).enableRLS();

/**
 * An install's Web Push subscription and what the cron still owes it. `deliveredThrough` is when the cron last
 * delivered to it, or when it subscribed. `nextAt` is the earliest pending notification, which the cron selects on.
 */
export const push = pgTable(
	'push',
	{
		userId: text('user_id').notNull(),
		deviceId: text('device_id').notNull(),
		subscription: jsonb('subscription').$type<ColumnValue<'push', 'subscription'>>().notNull(),
		notifications: jsonb('notifications').$type<ColumnValue<'push', 'notifications'>>().notNull(),
		deliveredThrough: millis('delivered_through').notNull(),
		nextAt: millis('next_at'),
	},
	table => [primaryKey({ columns: [table.userId, table.deviceId] }), index('push_next_at').on(table.nextAt)],
).enableRLS();

/** Ramble audio seconds one user streamed on `day`, a date key in the account's time zone. */
export const rambleUsage = pgTable(
	'ramble_usage',
	{
		userId: text('user_id').notNull(),
		day: text('day').notNull(),
		seconds: doublePrecision('seconds').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.day] })],
).enableRLS();

/**
 * Access the owner grants to their space, or to one project, label, or task in it. A null `grantee` is a public link,
 * always `view`, whose `id` is the secret in its token. Revoking deletes the row. `targetId` is empty for `space`.
 */
export const shares = pgTable(
	'shares',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		targetKind: text('target_kind', { enum: SHARE_TARGET_KINDS })
			.$type<ColumnValue<'shares', 'targetKind'>>()
			.notNull(),
		targetId: text('target_id').notNull(),
		grantee: text('grantee'),
		role: text('role', { enum: ROLES }).$type<ColumnValue<'shares', 'role'>>().notNull(),
		createdAt: millis('created_at').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.id] }), index('shares_grantee').on(table.grantee)],
).enableRLS();

/** An AI account's API token, kept by its owner. Only the secret's SHA-256 is stored. */
export const apiTokens = pgTable(
	'api_tokens',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		aiUserId: text('ai_user_id').notNull(),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		createdAt: millis('created_at').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.id] })],
).enableRLS();

/** postgres.js reads `bytea` as a `Buffer` and PGlite as a `Uint8Array`. */
const bytes = customType<{ data: Uint8Array<ArrayBuffer>; driverData: Uint8Array }>({
	dataType: () => 'bytea',
	toDriver: value => value,
	fromDriver: value => new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength),
});

/**
 * The bytes of task images, one row per size, outside the publication. A row is garbage once no task lists its id;
 * `orphanedAt` is when a sweep first saw that, and a later sweep deletes it after a grace period.
 */
export const images = pgTable(
	'images',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		size: text('size', { enum: IMAGE_SIZES }).notNull(),
		type: text('type', { enum: IMAGE_TYPES }).notNull(),
		bytes: bytes('bytes').$type<ColumnValue<'images', 'bytes'>>().notNull(),
		createdAt: millis('created_at').notNull(),
		orphanedAt: millis('orphaned_at'),
	},
	table => [primaryKey({ columns: [table.userId, table.id, table.size] })],
).enableRLS();

type Row<T extends { $inferSelect: object }> = Omit<T['$inferSelect'], 'userId'>;

export type LogRow = Row<typeof log>;
export type RambleUsage = Row<typeof rambleUsage>;
export type ShareRow = Row<typeof shares>;
export type ImageRow = Row<typeof images>;
export type AccessRow = typeof access.$inferSelect;
