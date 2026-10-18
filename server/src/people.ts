import { and, eq, inArray, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { shares } from '../../shared/db/schema';
import { namePrefixed, type Person } from '../../shared/sharing';
import { user } from './db/auth-schema';
import type { Db } from './db/postgres';

/** People are Better Auth's users. Activity, share lists, and comments name them from the `user` table. */

export function unknownPerson(id: string): Person {
	return { id, name: '', kind: 'human', ownerId: null };
}

const asPerson = (row: { id: string; name: string; kind: 'human' | 'ai'; ownerId: string | null }): Person => row;

export async function peopleById(db: Db, ids: readonly string[]): Promise<Map<string, Person>> {
	const wanted = [...new Set(ids)];
	if (!wanted.length) return new Map();
	const rows = await db
		.select({ id: user.id, name: user.name, kind: user.kind, ownerId: user.ownerId })
		.from(user)
		.where(inArray(user.id, wanted));
	return new Map(rows.map(row => [row.id, asPerson(row)]));
}

export async function personById(db: Db, id: string): Promise<Person | null> {
	return (await peopleById(db, [id])).get(id) ?? null;
}

export async function personOf(db: Db, id: string): Promise<Person> {
	return (await personById(db, id)) ?? unknownPerson(id);
}

/**
 * The people `me` knows, in one select: everyone they shared with, the owners of the spaces shared with them, and
 * their AI accounts, each filtered on a name prefix of `query`; and, when `query` is an email, its user. Link shares
 * have no grantee, so the joins drop them.
 */
export async function searchPeople(db: Db, me: string, query: string): Promise<Person[]> {
	const q = query.trim();
	const person = (rank: number) => ({
		rank: sql.raw(String(rank)).mapWith(Number).as('rank'),
		id: user.id,
		name: user.name,
		kind: user.kind,
		ownerId: user.ownerId,
	});
	const known = [
		db.select(person(1)).from(shares).innerJoin(user, eq(user.id, shares.grantee)).where(eq(shares.userId, me)),
		db.select(person(2)).from(shares).innerJoin(user, eq(user.id, shares.userId)).where(eq(shares.grantee, me)),
		db
			.select(person(3))
			.from(user)
			.where(and(eq(user.ownerId, me), eq(user.kind, 'ai'))),
	] as const;
	const byEmail = db.select(person(0)).from(user).where(eq(user.email, q.toLowerCase()));
	const rows = await (q.includes('@') ? unionAll(byEmail, ...known) : unionAll(...known)).orderBy(sql`rank`);
	const found = new Map<string, Person>();
	for (const { rank, ...row } of rows) {
		if (row.id === me || found.has(row.id)) continue;
		if (rank === 0 || !q || namePrefixed(row.name, q)) found.set(row.id, asPerson(row));
	}
	return [...found.values()];
}
