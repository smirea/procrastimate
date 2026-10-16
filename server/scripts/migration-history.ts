import { $ } from 'bun';
import { isDeepStrictEqual } from 'node:util';

/**
 * Fails unless this branch's `server/drizzle` history strictly extends the base's: every entry the base has, unchanged
 * and in order, with its SQL untouched, then only new entries, each later than the one before. A database's history
 * is the `when` of each applied entry, so anything else makes the migrator refuse every persistent database.
 *
 * Usage: bun server/scripts/migration-history.ts [base ref, default origin/master]
 */

type Entry = { idx: number; when: number; tag: string };
export type History = { entries: Entry[]; sql: (tag: string) => string | null };

const describe = (entry: Entry) => `${entry.tag} (idx ${entry.idx}, when ${entry.when})`;

export function historyProblems(base: History, head: History): string[] {
	const problems: string[] = [];
	base.entries.forEach((kept, index) => {
		const entry = head.entries[index];
		if (!entry) problems.push(`${describe(kept)} is missing.`);
		else if (!isDeepStrictEqual(entry, kept)) problems.push(`${describe(kept)} became ${describe(entry)}.`);
		else if (head.sql(kept.tag) !== base.sql(kept.tag)) problems.push(`${kept.tag}.sql was edited.`);
	});
	head.entries.slice(base.entries.length).forEach((added, offset) => {
		const index = base.entries.length + offset;
		const previous = head.entries[index - 1];
		if (added.idx !== index) problems.push(`${describe(added)} should have idx ${index}.`);
		if (previous && added.when <= previous.when) {
			problems.push(`${describe(added)} is not later than ${describe(previous)}.`);
		}
	});
	return problems;
}

const JOURNAL = 'server/drizzle/meta/_journal.json';
const sqlPath = (tag: string) => `server/drizzle/${tag}.sql`;

async function fromRef(ref: string): Promise<History> {
	const show = async (path: string) => {
		const result = await $`git show ${`${ref}:${path}`}`.quiet().nothrow();
		return result.exitCode === 0 ? result.text() : null;
	};
	const journal = await show(JOURNAL);
	if (journal === null) throw new Error(`${ref} has no ${JOURNAL}. Fetch it first: git fetch origin master`);
	const entries: Entry[] = JSON.parse(journal).entries;
	const files = new Map(
		await Promise.all(entries.map(async entry => [entry.tag, await show(sqlPath(entry.tag))] as const)),
	);
	return { entries, sql: tag => files.get(tag) ?? null };
}

async function fromWorkingTree(): Promise<History> {
	const entries: Entry[] = (await Bun.file(JOURNAL).json()).entries;
	const files = new Map(
		await Promise.all(
			entries.map(async entry => {
				const file = Bun.file(sqlPath(entry.tag));
				return [entry.tag, (await file.exists()) ? await file.text() : null] as const;
			}),
		),
	);
	return { entries, sql: tag => files.get(tag) ?? null };
}

if (import.meta.main) {
	const ref = process.argv[2] ?? 'origin/master';
	const problems = historyProblems(await fromRef(ref), await fromWorkingTree());
	if (problems.length) {
		console.error(`server/drizzle does not strictly extend ${ref}'s migration history:`);
		for (const problem of problems) console.error(`  ${problem}`);
		console.error(
			`Delete this branch's new migrations (SQL, snapshot, and journal entry), rebase onto ${ref}, and run 'bun run db:generate'.`,
		);
		process.exit(1);
	}
	console.log(`server/drizzle strictly extends ${ref}.`);
}
