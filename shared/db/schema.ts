import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PushSubscriptionInfo, ScheduledPush } from '../push.ts';
import type { Hlc } from '../sync/hlc.ts';
import { KINDS } from '../sync/kinds.ts';
import type { Fields } from '../sync/snapshot.ts';

/**
 * The account database, the same tables in Turso and in the `Account` Durable Object's SQLite. Every row but the
 * global Ramble budget belongs to one user, so one Turso database holds every account.
 */

/** The current value of every task, project, label, and the settings record, with one clock per field. */
export const entities = sqliteTable(
	'entities',
	{
		userId: text('user_id').notNull(),
		kind: text('kind', { enum: KINDS }).notNull(),
		id: text('id').notNull(),
		data: text('data', { mode: 'json' }).$type<Fields>().notNull(),
		clocks: text('clocks', { mode: 'json' }).$type<Record<string, Hlc>>().notNull(),
	},
	table => [primaryKey({ columns: [table.userId, table.kind, table.id] })],
);

/** Append-only: the fields of one op that won, at server sequence `seq`, which starts at 1 for each user. */
export const log = sqliteTable(
	'log',
	{
		userId: text('user_id').notNull(),
		seq: integer('seq').notNull(),
		opId: text('op_id').notNull(),
		kind: text('kind', { enum: KINDS }).notNull(),
		id: text('id').notNull(),
		fields: text('fields', { mode: 'json' }).$type<Fields>().notNull(),
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
		subscription: text('subscription', { mode: 'json' }).$type<PushSubscriptionInfo>().notNull(),
		notifications: text('notifications', { mode: 'json' }).$type<ScheduledPush[]>().notNull(),
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

/** Audio seconds the whole deployment streamed on one UTC day. */
export const rambleBudget = sqliteTable('ramble_budget', {
	day: text('day').primaryKey(),
	seconds: real('seconds').notNull(),
});

type Row<T extends { $inferSelect: object }> = Omit<T['$inferSelect'], 'userId'>;

export type Entity = Row<typeof entities>;
export type LogRow = Row<typeof log>;
export type Device = Row<typeof devices>;
export type PushTarget = Row<typeof push>;
export type RambleUsage = Row<typeof rambleUsage>;
