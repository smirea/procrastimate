/**
 * One table of Drizzle column types: the Zod schema a row schema reads a value with, and the column kind the clients'
 * local tables store it as. A JSON column's shape comes from `COLUMN_VALUES`, so it has no Zod entry here.
 */
export type LocalKind = 'text' | 'integer' | 'real' | 'json';

export const COLUMN_TYPES: Record<string, { zod?: string; local?: LocalKind }> = {
	SQLiteText: { zod: 'z.string()', local: 'text' },
	SQLiteInteger: { zod: 'z.number().int()', local: 'integer' },
	SQLiteReal: { zod: 'z.number()', local: 'real' },
	SQLiteBoolean: { zod: 'z.boolean()', local: 'integer' },
	SQLiteTimestamp: { zod: 'z.date()' },
	SQLiteTextJson: { local: 'json' },
};
