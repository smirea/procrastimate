import { and, eq, inArray } from 'drizzle-orm';
import { access, shares, tasks } from '../../shared/db/schema';
import { namePrefixed, type Person } from '../../shared/sharing';
import { user } from './db/auth-schema';
import type { Db } from './db/sqlite';
import { chunks } from './db/chunks';

/** People are Better Auth's users. Activity, share lists, and comments name them from the `user` table. */

export function unknownPerson(id: string): Person {
	return { id, name: '', kind: 'human', ownerId: null };
}

const asPerson = (row: { id: string; name: string; kind: 'human' | 'ai'; ownerId: string | null }): Person => row;

export async function peopleById(db: Db, ids: readonly string[]): Promise<Map<string, Person>> {
	const wanted = [...new Set(ids)];
	if (!wanted.length) return new Map();
	const rows = chunks(wanted).flatMap(part =>
		db
			.select({ id: user.id, name: user.name, kind: user.kind, ownerId: user.ownerId })
			.from(user)
			.where(inArray(user.id, part))
			.all(),
	);
	return new Map(rows.map(row => [row.id, asPerson(row)]));
}

export async function personById(db: Db, id: string): Promise<Person | null> {
	return (await peopleById(db, [id])).get(id) ?? null;
}

export async function personOf(db: Db, id: string): Promise<Person> {
	return (await personById(db, id)) ?? unknownPerson(id);
}

/**
 * The people `me` knows: everyone they shared with, the owners of the spaces shared with them, their AI accounts, and
 * whoever made or finished a task `me` sees (its own, or one its `access` rows name), each filtered on a name prefix of
 * `query`; and, when `query` is an email, its user first. Link shares have no grantee, so the joins drop them. The
 * task authors are how a guest names a co-guest, and the owner a guest whose share is gone, without learning who acts
 * only on tasks it cannot see. One select per source, in that order: a Durable Object's SQLite refuses a `UNION ALL`
 * of this many terms.
 */
export function searchPeople(db: Db, me: string, query: string): Person[] {
	const q = query.trim();
	const person = { id: user.id, name: user.name, kind: user.kind, ownerId: user.ownerId };
	const sources = [
		...(q.includes('@')
			? [{ exact: true, rows: db.select(person).from(user).where(eq(user.email, q.toLowerCase())).all() }]
			: []),
		...[
			db.select(person).from(shares).innerJoin(user, eq(user.id, shares.grantee)).where(eq(shares.userId, me)),
			db.select(person).from(shares).innerJoin(user, eq(user.id, shares.userId)).where(eq(shares.grantee, me)),
			db
				.select(person)
				.from(user)
				.where(and(eq(user.ownerId, me), eq(user.kind, 'ai'))),
			...[tasks.createdBy, tasks.completedBy].flatMap(column => [
				db.selectDistinct(person).from(tasks).innerJoin(user, eq(user.id, column)).where(eq(tasks.userId, me)),
				db
					.selectDistinct(person)
					.from(access)
					.innerJoin(tasks, and(eq(access.kind, 'task'), eq(tasks.id, access.entityId)))
					.innerJoin(user, eq(user.id, column))
					.where(eq(access.grantee, me)),
			]),
		].map(select => ({ exact: false, rows: select.all() })),
	];
	const found = new Map<string, Person>();
	for (const { exact, rows } of sources) {
		for (const row of rows) {
			if (row.id === me || found.has(row.id)) continue;
			if (exact || !q || namePrefixed(row.name, q)) found.set(row.id, asPerson(row));
		}
	}
	return [...found.values()];
}
