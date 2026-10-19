/**
 * One table of Drizzle column types: the Zod schema a row schema reads a value with, and the PowerSync column kind
 * the local tables store it as. A JSON column's shape comes from `COLUMN_VALUES`, so it has no Zod entry here.
 */
export type LocalKind = 'text' | 'integer' | 'real' | 'json';

export const COLUMN_TYPES: Record<string, { zod?: string; local?: LocalKind }> = {
	PgText: { zod: 'z.string()', local: 'text' },
	PgInteger: { zod: 'z.number().int()', local: 'integer' },
	PgBigInt53: { zod: 'z.number().int()', local: 'integer' },
	PgBigSerial53: { zod: 'z.number().int()' },
	PgDoublePrecision: { zod: 'z.number()', local: 'real' },
	PgBoolean: { zod: 'z.boolean()', local: 'integer' },
	PgJsonb: { local: 'json' },
};
