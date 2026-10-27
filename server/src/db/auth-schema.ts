import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ACTOR_KINDS } from '../../../shared/values';

/** Better Auth's tables, in the shape its Drizzle adapter expects. */
const at = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
	image: text('image'),
	createdAt: at('createdAt').notNull(),
	updatedAt: at('updatedAt').notNull(),
	/** `ai` accounts have no credential, so they never sign in; they act through API tokens their owner made. */
	kind: text('kind', { enum: ACTOR_KINDS }).notNull().default('human'),
	ownerId: text('owner_id'),
});

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: at('expiresAt').notNull(),
		token: text('token').notNull().unique(),
		createdAt: at('createdAt').notNull(),
		updatedAt: at('updatedAt').notNull(),
		ipAddress: text('ipAddress'),
		userAgent: text('userAgent'),
		userId: text('userId')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	table => [index('session_userId_idx').on(table.userId)],
);

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('accountId').notNull(),
		providerId: text('providerId').notNull(),
		userId: text('userId')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('accessToken'),
		refreshToken: text('refreshToken'),
		idToken: text('idToken'),
		accessTokenExpiresAt: at('accessTokenExpiresAt'),
		refreshTokenExpiresAt: at('refreshTokenExpiresAt'),
		scope: text('scope'),
		password: text('password'),
		createdAt: at('createdAt').notNull(),
		updatedAt: at('updatedAt').notNull(),
	},
	table => [index('account_userId_idx').on(table.userId)],
);

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: at('expiresAt').notNull(),
		createdAt: at('createdAt').notNull(),
		updatedAt: at('updatedAt').notNull(),
	},
	table => [index('verification_identifier_idx').on(table.identifier)],
);

/** Sign-in rate limits, in the database so every request enforces the same limits. */
export const rateLimit = sqliteTable('rateLimit', {
	id: text('id').primaryKey(),
	key: text('key').notNull().unique(),
	count: integer('count').notNull(),
	lastRequest: integer('lastRequest').notNull(),
});

export const authSchema = { user, session, account, verification, rateLimit };
