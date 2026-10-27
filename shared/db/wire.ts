import { getTableColumns, type Column } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Fields } from '../snapshot.ts';

/**
 * sync-engine carries rows as the database stores them: column names, JSON as text, booleans as integers. The domain
 * reads Drizzle's properties with JSON parsed. These convert one row's values either way through the table's own
 * columns, so a new column needs no change here.
 */

type Wire = Record<string, string | number | null>;

const columnsOf = (() => {
	const cache = new WeakMap<SQLiteTable, { byName: Map<string, [string, Column]>; byKey: Map<string, Column> }>();
	return (table: SQLiteTable) => {
		let found = cache.get(table);
		if (!found) {
			const entries = Object.entries(getTableColumns(table) as Record<string, Column>);
			found = {
				byName: new Map(entries.map(([key, column]) => [column.name, [key, column]])),
				byKey: new Map(entries),
			};
			cache.set(table, found);
		}
		return found;
	};
})();

/** The wire values as domain fields, keyed by property. Unknown columns are dropped. */
export function fromWire(table: SQLiteTable, values: Readonly<Wire>): Fields {
	const { byName } = columnsOf(table);
	const fields: Fields = {};
	for (const [name, value] of Object.entries(values)) {
		const found = byName.get(name);
		if (!found) continue;
		const [key, column] = found;
		fields[key] = value === null ? null : column.mapFromDriverValue(value);
	}
	return fields;
}

/** Domain fields as wire values. Undefined fields are left out; unknown keys throw, since they would be lost. */
export function toWire(table: SQLiteTable, fields: Readonly<Fields>): Wire {
	const { byKey } = columnsOf(table);
	const values: Wire = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue;
		const column = byKey.get(key);
		if (!column) throw new Error(`toWire: ${key} is not a column`);
		values[column.name] = value === null ? null : (column.mapToDriverValue(value) as string | number);
	}
	return values;
}
