import { DrizzleAppSchema } from '@powersync/drizzle-driver';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
	id: text('id').primaryKey().notNull(),
	userId: text('user_id').notNull(),
	title: text('title').notNull(),
	notes: text('notes').notNull(),
	labelIds: text('label_ids', { mode: 'json' }).$type<string[]>().notNull(),
	due: text('due', { mode: 'json' }).$type<{ date: string; time?: string } | null>(),
	priority: integer('priority').notNull(),
	order: real('order').notNull(),
	createdAt: integer('created_at').notNull(),
	completedAt: integer('completed_at'),
	createdBy: text('created_by'),
});

export const access = sqliteTable('access', {
	id: text('id').primaryKey().notNull(),
	grantee: text('grantee').notNull(),
	owner: text('owner').notNull(),
	kind: text('kind').notNull(),
	entityId: text('entity_id').notNull(),
	role: text('role', { enum: ['view', 'edit'] }).notNull(),
});

export const drizzleSchema = { tasks, access };
export const AppSchema = new DrizzleAppSchema(drizzleSchema);
