import { index, integer, primaryKey, real, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { DICTATION_CHOICES } from '../dictation.ts';
import { KINDS } from '../sync/kinds.ts';
import { ACTOR_KINDS, DEFAULT_PRIORITY, ROLES, SERVER_ACTOR, SHARE_TARGET_KINDS } from '../values.ts';
import type { ColumnValue } from './json.ts';

/**
 * The account database, the same tables in Turso and in the `Account` Durable Object's SQLite. Every row but the
 * global Ramble budget belongs to one user, so one Turso database holds every account.
 */

/**
 * One table per synced kind, a column per field. A row also keeps one clock per field it holds, and that is what
 * says which fields it has: a row the server only heard a partial edit or a delete for keeps the rest at a filler
 * value, which means nothing until a clock is set for it. `deleted` makes a row a tombstone. Column defaults are the
 * domain's, which new entities and the Swift initializers start from.
 */
const clocks = () => text('clocks', { mode: 'json' }).$type<ColumnValue<'tasks', 'clocks'>>().notNull();
const deleted = () => integer('deleted', { mode: 'boolean' }).notNull().default(false);
const userEntity = <T extends { userId: AnySQLiteColumn; id: AnySQLiteColumn }>(table: T) => [
	primaryKey({ columns: [table.userId, table.id] }),
];

export const tasks = sqliteTable(
	'tasks',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		/** The task this one is a subtask of. A subtask shares its root task's project. */
		parentId: text('parent_id'),
		order: real('order').notNull().default(0),
		title: text('title').notNull(),
		notes: text('notes').notNull().default(''),
		projectId: text('project_id'),
		labelIds: text('label_ids', { mode: 'json' }).$type<ColumnValue<'tasks', 'labelIds'>>().notNull().default([]),
		due: text('due', { mode: 'json' }).$type<ColumnValue<'tasks', 'due'>>(),
		recurrence: text('recurrence', { mode: 'json' }).$type<ColumnValue<'tasks', 'recurrence'>>(),
		priority: integer('priority').$type<ColumnValue<'tasks', 'priority'>>().notNull().default(DEFAULT_PRIORITY),
		reminders: text('reminders', { mode: 'json' }).$type<ColumnValue<'tasks', 'reminders'>>().notNull().default([]),
		/** Set only on iOS. A task with a location gets no notification at its due time; the place is its nudge. */
		location: text('location', { mode: 'json' }).$type<ColumnValue<'tasks', 'location'>>(),
		/** Set only on iOS. A task with an event has no due date or repeat; the event's times stand in for both. */
		event: text('event', { mode: 'json' }).$type<ColumnValue<'tasks', 'event'>>(),
		createdAt: integer('created_at').notNull(),
		completedAt: integer('completed_at'),
		/** Who created the task and who completed it last. The server stamps both and overwrites what a client sends. */
		createdBy: text('created_by'),
		completedBy: text('completed_by'),
		/** Every completion sets it, a recurring roll included, so a roll reads differently from a postpone. */
		lastCompletedAt: integer('last_completed_at'),
		/** Where an imported task came from, such as `todoist:task:…`, so importing the same backup again skips it. */
		sourceKey: text('source_key'),
		deleted: deleted(),
		clocks: clocks(),
	},
	userEntity,
);

export const projects = sqliteTable(
	'projects',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		name: text('name').notNull(),
		createdAt: integer('created_at').notNull(),
		sourceKey: text('source_key'),
		deleted: deleted(),
		clocks: clocks(),
	},
	userEntity,
);

export const labels = sqliteTable(
	'labels',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		name: text('name').notNull(),
		createdAt: integer('created_at').notNull(),
		deleted: deleted(),
		clocks: clocks(),
	},
	userEntity,
);

/** The one settings record per user, whose id is always `settings`. It cannot be deleted. */
export const settings = sqliteTable(
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
		clocks: clocks(),
	},
	userEntity,
);

/** Each kind's table, so code that handles every kind finds its columns in one place. */
export const ENTITY_TABLES = { task: tasks, project: projects, label: labels, settings } as const;

/** Append-only: the fields of one op that won, at server sequence `seq`, which starts at 1 for each user. */
export const log = sqliteTable(
	'log',
	{
		userId: text('user_id').notNull(),
		seq: integer('seq').notNull(),
		opId: text('op_id').notNull(),
		kind: text('kind', { enum: KINDS }).notNull(),
		id: text('id').notNull(),
		fields: text('fields', { mode: 'json' }).$type<ColumnValue<'log', 'fields'>>().notNull(),
		/** The user id of whoever sent the op, or `server` for a fixup. The server stamps it; clients never send it. */
		actor: text('actor').notNull().default(SERVER_ACTOR),
		/** Server time when the row was written. */
		at: integer('at').notNull().default(0),
	},
	table => [primaryKey({ columns: [table.userId, table.seq] }), index('log_op_id').on(table.userId, table.opId)],
);

/** A registered install. `revokedAt` is set once its token is removed; the row stays so the id is never reused. */
export const devices = sqliteTable(
	'devices',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		createdAt: integer('created_at').notNull(),
		lastSeenAt: integer('last_seen_at').notNull(),
		revokedAt: integer('revoked_at'),
	},
	table => [primaryKey({ columns: [table.userId, table.id] })],
);

/** Per-user values. The only key is `epoch`, bumped when task data is wiped. */
export const meta = sqliteTable(
	'meta',
	{
		userId: text('user_id').notNull(),
		key: text('key', { enum: ['epoch'] }).notNull(),
		value: text('value').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.key] })],
);

/**
 * A device's Web Push subscription and what the alarm still owes it. `deliveredThrough` is when the alarm last ran
 * for it, or when it subscribed.
 */
export const push = sqliteTable(
	'push',
	{
		userId: text('user_id').notNull(),
		deviceId: text('device_id').notNull(),
		subscription: text('subscription', { mode: 'json' }).$type<ColumnValue<'push', 'subscription'>>().notNull(),
		notifications: text('notifications', { mode: 'json' }).$type<ColumnValue<'push', 'notifications'>>().notNull(),
		deliveredThrough: integer('delivered_through').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.deviceId] })],
);

/** Ramble audio seconds one user streamed on `day`, a date key in the account's time zone. */
export const rambleUsage = sqliteTable(
	'ramble_usage',
	{
		userId: text('user_id').notNull(),
		day: text('day').notNull(),
		seconds: real('seconds').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.day] })],
);

/**
 * Access the owner grants to their space, or to one project, label, or task in it. A null `grantee` is a public link,
 * always `view`, whose `id` is the secret in its token. Revoking deletes the row. `targetId` is empty for `space`.
 */
export const shares = sqliteTable(
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
		createdAt: integer('created_at').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.id] })],
);

/** A space shared with this user, by its owner's id. A cache the owner writes; the owner's shares are the truth. */
export const memberships = sqliteTable(
	'memberships',
	{
		userId: text('user_id').notNull(),
		spaceId: text('space_id').notNull(),
		createdAt: integer('created_at').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.spaceId] })],
);

/** Everyone this space has met, so activity and share lists can name them. `seenAt` is the last time it did. */
export const people = sqliteTable(
	'people',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		name: text('name').notNull(),
		kind: text('kind', { enum: ACTOR_KINDS }).$type<ColumnValue<'people', 'kind'>>().notNull(),
		ownerId: text('owner_id'),
		seenAt: integer('seen_at').notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.id] })],
);

/** An AI account's API token, kept by its owner. Only the secret's SHA-256 is stored. */
export const apiTokens = sqliteTable(
	'api_tokens',
	{
		userId: text('user_id').notNull(),
		id: text('id').notNull(),
		aiUserId: text('ai_user_id').notNull(),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		createdAt: integer('created_at').notNull(),
		lastUsedAt: integer('last_used_at'),
	},
	table => [primaryKey({ columns: [table.userId, table.id] })],
);

export const rambleBudget = sqliteTable('ramble_budget', {
	day: text('day').primaryKey(),
	seconds: real('seconds').notNull(),
});

type Row<T extends { $inferSelect: object }> = Omit<T['$inferSelect'], 'userId'>;

export type LogRow = Row<typeof log>;
export type Device = Row<typeof devices>;
export type PushTarget = Row<typeof push>;
export type RambleUsage = Row<typeof rambleUsage>;
export type ShareRow = Row<typeof shares>;
export type Membership = Row<typeof memberships>;
export type PersonRow = Row<typeof people>;
export type ApiTokenRow = Row<typeof apiTokens>;
