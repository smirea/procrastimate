import { customType, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Better Auth's tables, as its Kysely migrations created them in production: camelCase columns, and dates as ISO
 * strings in `date` columns, which also sort in time order.
 */
const isoDate = customType<{ data: Date; driverData: string }>({
	dataType: () => 'date',
	toDriver: value => value.toISOString(),
	fromDriver: value => new Date(value),
});

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
	image: text('image'),
	createdAt: isoDate('createdAt').notNull(),
	updatedAt: isoDate('updatedAt').notNull(),
});

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: isoDate('expiresAt').notNull(),
		token: text('token').notNull().unique(),
		createdAt: isoDate('createdAt').notNull(),
		updatedAt: isoDate('updatedAt').notNull(),
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
		accessTokenExpiresAt: isoDate('accessTokenExpiresAt'),
		refreshTokenExpiresAt: isoDate('refreshTokenExpiresAt'),
		scope: text('scope'),
		password: text('password'),
		createdAt: isoDate('createdAt').notNull(),
		updatedAt: isoDate('updatedAt').notNull(),
	},
	table => [index('account_userId_idx').on(table.userId)],
);

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: isoDate('expiresAt').notNull(),
		createdAt: isoDate('createdAt').notNull(),
		updatedAt: isoDate('updatedAt').notNull(),
	},
	table => [index('verification_identifier_idx').on(table.identifier)],
);

/** Sign-in rate limits. Only Turso stores them, so a new Worker isolate still enforces them. */
export const rateLimit = sqliteTable('rateLimit', {
	id: text('id').primaryKey(),
	key: text('key').notNull().unique(),
	count: integer('count').notNull(),
	lastRequest: integer('lastRequest').notNull(),
});

export const authSchema = { user, session, account, verification, rateLimit };
