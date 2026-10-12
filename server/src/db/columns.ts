import { getTableColumns } from 'drizzle-orm';
import { devices, entities, log, push, rambleUsage } from '../../../shared/db/schema';

/** Each table's columns without `userId`, for selecting the row types the store hands out. */
function withoutUser<T extends { userId: unknown }>(columns: T): Omit<T, 'userId'> {
	const { userId: _, ...rest } = columns;
	return rest;
}

export const deviceColumns = withoutUser(getTableColumns(devices));
export const entityColumns = withoutUser(getTableColumns(entities));
export const logColumns = withoutUser(getTableColumns(log));
export const pushColumns = withoutUser(getTableColumns(push));
export const rambleColumns = withoutUser(getTableColumns(rambleUsage));
