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

type PersonRow = { id: string; name: string; kind: 'human' | 'ai'; ownerId: string | null; email: string };

/** A human with the email the share sheet shows. An AI account's email is a placeholder nobody reads, so it has none. */
const withEmail = ({ email, ...row }: PersonRow): Person => (row.kind === 'human' ? { ...row, email } : asPerson(row));

/**
 * Every human but `me`, with their email, and the AI accounts `me` knows: its own, those it shared with, and those
 * that made or finished a task `me` sees (its own, or one its `access` rows name), so a guest names a co-guest's bot.
 * Each matches a name or email prefix of `query`, and an empty one lists them all. Anyone can list every user: the
 * share sheet offers them all, and sign-up is closed, so they are people Stefan let in. Link shares have no grantee,
 * so the join drops them. One select per source: a Durable Object's SQLite refuses a `UNION ALL` of this many terms.
 */
export function searchPeople(db: Db, me: string, query: string): Person[] {
	const q = query.trim();
	const person = { id: user.id, name: user.name, kind: user.kind, ownerId: user.ownerId, email: user.email };
	const sources: PersonRow[][] = [
		db.select(person).from(user).where(eq(user.kind, 'human')).orderBy(user.name).all(),
		db.select(person).from(shares).innerJoin(user, eq(user.id, shares.grantee)).where(eq(shares.userId, me)).all(),
		db
			.select(person)
			.from(user)
			.where(and(eq(user.ownerId, me), eq(user.kind, 'ai')))
			.all(),
		...[tasks.createdBy, tasks.completedBy].flatMap(column => [
			db.selectDistinct(person).from(tasks).innerJoin(user, eq(user.id, column)).where(eq(tasks.userId, me)).all(),
			db
				.selectDistinct(person)
				.from(access)
				.innerJoin(tasks, and(eq(access.kind, 'task'), eq(tasks.id, access.entityId)))
				.innerJoin(user, eq(user.id, column))
				.where(eq(access.grantee, me))
				.all(),
		]),
	];
	const found = new Map<string, Person>();
	for (const row of sources.flat()) {
		if (row.id === me || found.has(row.id)) continue;
		if (!q || namePrefixed(row.name, q) || (row.kind === 'human' && namePrefixed(row.email, q)))
			found.set(row.id, withEmail(row));
	}
	return [...found.values()];
}
