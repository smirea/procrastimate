import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const tasks = pgTable(
	'tasks',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		title: text('title').notNull(),
		notes: text('notes').notNull().default(''),
		labelIds: jsonb('label_ids').$type<string[]>().notNull().default([]),
		due: jsonb('due').$type<{ date: string; time?: string } | null>(),
		priority: integer('priority').notNull().default(4),
		order: doublePrecision('order').notNull().default(0),
		createdAt: bigint('created_at', { mode: 'number' }).notNull(),
		completedAt: bigint('completed_at', { mode: 'number' }),
		createdBy: text('created_by'),
	},
	table => [index('tasks_user_id').on(table.userId)],
).enableRLS();

export const access = pgTable(
	'access',
	{
		id: text('id').primaryKey(),
		grantee: text('grantee').notNull(),
		owner: text('owner').notNull(),
		kind: text('kind', { enum: ['task', 'project', 'label'] }).notNull(),
		entityId: text('entity_id').notNull(),
		role: text('role', { enum: ['view', 'edit'] }).notNull(),
	},
	table => [index('access_grantee').on(table.grantee)],
).enableRLS();

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('emailVerified').notNull(),
	image: text('image'),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull(),
}).enableRLS();

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expiresAt').notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull(),
	ipAddress: text('ipAddress'),
	userAgent: text('userAgent'),
	userId: text('userId')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
}).enableRLS();

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	accountId: text('accountId').notNull(),
	providerId: text('providerId').notNull(),
	userId: text('userId')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('accessToken'),
	refreshToken: text('refreshToken'),
	idToken: text('idToken'),
	accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
	refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull(),
}).enableRLS();

export const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expiresAt').notNull(),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull(),
}).enableRLS();

export const jwks = pgTable('jwks', {
	id: text('id').primaryKey(),
	publicKey: text('publicKey').notNull(),
	privateKey: text('privateKey').notNull(),
	createdAt: timestamp('createdAt').notNull(),
	expiresAt: timestamp('expiresAt'),
	alg: text('alg'),
	crv: text('crv'),
}).enableRLS();

export const authSchema = { user, session, account, verification, jwks };
export const SYNCED = { tasks } as const;
