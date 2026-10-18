import { wrapPowerSyncWithDrizzle } from '@powersync/drizzle-driver';
import { PowerSyncDatabase } from '@powersync/web';
import { eq } from 'drizzle-orm';
import { KINDS, type Kind } from 'shared/model.ts';
import { TABLE_OF, type RowWrite } from 'shared/rows.ts';
import type { Fields } from 'shared/snapshot.ts';
import { AppSchema, localTables } from './generated/tables.ts';

export const powerSync = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: 'procrastimate.db' } });
const db = wrapPowerSyncWithDrizzle(powerSync, { schema: localTables });

export const WATCHED_TABLES = [...KINDS.map(kind => TABLE_OF[kind]), 'access'];

export type Row = { userId: string; id: string } & Fields;
export type AccessRow = typeof localTables.access.$inferSelect;
export type Rows = Record<Kind, Row[]> & { access: AccessRow[] };

/** Every row, read in one transaction so a sync applying between two tables cannot tear the result. */
export function readRows(): Promise<Rows> {
	return db.transaction(
		async tx => {
			const rows = { access: await tx.select().from(localTables.access) } as Rows;
			for (const kind of KINDS) rows[kind] = (await tx.select().from(localTables[TABLE_OF[kind]])) as Row[];
			return rows;
		},
		{ accessMode: 'read only' },
	);
}

/**
 * PowerSync's tables are views that refuse an upsert, so a put of a row that is already here, as after a reload raced
 * the command, updates it instead.
 */
export function writeRows(owner: string, writes: readonly RowWrite[]): Promise<void> {
	return db.transaction(async tx => {
		for (const { op, kind, id, values } of writes) {
			const table = localTables[TABLE_OF[kind]];
			const where = eq(table.id, id);
			if (op === 'delete') {
				await tx.delete(table).where(where);
				continue;
			}
			const exists = op === 'patch' || (await tx.select({ id: table.id }).from(table).where(where)).length > 0;
			if (exists) await tx.update(table).set(values!).where(where);
			else await tx.insert(table).values({ ...values, id, userId: owner } as never);
		}
	});
}
