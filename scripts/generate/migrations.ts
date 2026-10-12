import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Journal = { entries: { idx: number; when: number; tag: string }[] };

/** `server/drizzle` as a module, since neither the Worker nor a Durable Object can read the migration files. */
export function migrationsModule(folder: string): string {
	const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as Journal;
	const migrations = journal.entries.map(entry => ({
		tag: entry.tag,
		when: entry.when,
		statements: readFileSync(join(folder, `${entry.tag}.sql`), 'utf8')
			.split('--> statement-breakpoint')
			.map(statement => statement.trim())
			.filter(Boolean),
	}));
	return `export const migrations: { tag: string; when: number; statements: string[] }[] = ${JSON.stringify(migrations, null, '\t')};\n`;
}
