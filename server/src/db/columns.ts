import { getTableColumns } from 'drizzle-orm';
import { apiTokens, devices, log, memberships, people, push, rambleUsage, shares } from '../../../shared/db/schema';

/** Each table's columns without `userId`, for selecting the row types the store hands out. */
function withoutUser<T extends { userId: unknown }>(columns: T): Omit<T, 'userId'> {
	const { userId: _, ...rest } = columns;
	return rest;
}

export const deviceColumns = withoutUser(getTableColumns(devices));
export const logColumns = withoutUser(getTableColumns(log));
export const pushColumns = withoutUser(getTableColumns(push));
export const rambleColumns = withoutUser(getTableColumns(rambleUsage));
export const shareColumns = withoutUser(getTableColumns(shares));
export const membershipColumns = withoutUser(getTableColumns(memberships));
export const personColumns = withoutUser(getTableColumns(people));
export const apiTokenColumns = withoutUser(getTableColumns(apiTokens));
