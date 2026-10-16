import journal from '../../server/drizzle/meta/_journal.json';

/**
 * `server/drizzle` as a module, since neither the Worker nor a Durable Object can read the migration files. Imported
 * rather than read so `bun --watch` regenerates when a migration changes.
 */
export async function migrationsModule(): Promise<string> {
	const migrations = await Promise.all(
		journal.entries.map(async entry => ({
			tag: entry.tag,
			when: entry.when,
			statements: (
				(await import(`../../server/drizzle/${entry.tag}.sql`, { with: { type: 'text' } })) as { default: string }
			).default
				.split('--> statement-breakpoint')
				.map(statement => statement.trim())
				.filter(Boolean),
		})),
	);
	return `export const migrations: { tag: string; when: number; statements: string[] }[] = ${JSON.stringify(migrations, null, '\t')};\n`;
}
