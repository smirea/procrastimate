import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import postgres from 'postgres';

/**
 * The local Postgres and PowerSync in `docker/compose.yaml`, as the worktree scripts drive them. One Postgres
 * container on `POSTGRES_PORT` serves every worktree, each in its own database named after its branch, next to a
 * `<database>_powersync` database for that worktree's PowerSync container. The container carries the worktree's path
 * as a label and the database as a comment, so `worktree-gc.ts` finds what a removed worktree left behind.
 */

export const POSTGRES_PORT = 5440;
const ADMIN_URL = `postgres://postgres:postgres@127.0.0.1:${POSTGRES_PORT}/postgres`;
const WORKTREE_LABEL = 'procrastimate.worktree';
const COMMENT_PREFIX = 'procrastimate worktree ';

const root = join(import.meta.dir, '..');
const compose = join(root, 'docker/compose.yaml');

export const databaseUrl = (database: string) => `postgres://postgres:postgres@127.0.0.1:${POSTGRES_PORT}/${database}`;

export function databaseOf(url: string): string {
	return new URL(url).pathname.slice(1);
}

/** Postgres identifiers are 63 bytes, and the `_powersync` suffix needs room. */
export function databaseName(branch: string): string {
	const name = branch
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '_')
		.replaceAll(/^_+|_+$/g, '')
		.slice(0, 50);
	return /^[a-z]/.test(name) ? name : `wt_${name}`;
}

/** The compose project and container suffix: the worktree directory, which outlives a branch rename. */
export const worktreeKey = (worktree: string) => basename(worktree).replaceAll(/[^A-Za-z0-9_.-]/g, '-');

/** Each worktree runs two stacks: `dev` for `bun run start`, `e2e` for the API server Playwright starts. */
export type Stack = 'dev' | 'e2e';
export const STACKS: readonly Stack[] = ['dev', 'e2e'];
const suffix = (stack: Stack) => (stack === 'dev' ? '' : '_e2e');
const containerName = (worktree: string, stack: Stack) =>
	`procrastimate-powersync-${worktreeKey(worktree)}${stack === 'dev' ? '' : '-e2e'}`;

function run(cmd: string[], env: Record<string, string> = {}): string {
	const result = spawnSync(cmd[0]!, cmd.slice(1), {
		encoding: 'utf8',
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (result.status !== 0) throw new Error(`\`${cmd.join(' ')}\` failed\n${result.stderr}${result.stdout}`);
	return result.stdout.trim();
}

export function dockerRunning(): boolean {
	return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

export function requireDocker(): void {
	if (dockerRunning()) return;
	throw new Error('Docker is not running. Start Docker Desktop (or `colima start`), then rerun this script.');
}

export function ensurePostgres(): void {
	run(['docker', 'compose', '-f', compose, '-p', 'procrastimate', 'up', '-d', '--wait', 'postgres']);
}

async function withAdmin<T>(use: (sql: postgres.Sql) => Promise<T>): Promise<T> {
	const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
	try {
		return await use(sql);
	} finally {
		await sql.end();
	}
}

const databasesOf = (database: string, stack: Stack) => [
	`${database}${suffix(stack)}`,
	`${database}${suffix(stack)}_powersync`,
];

export async function ensureDatabases(database: string, stack: Stack, worktree: string, reset = false): Promise<void> {
	await withAdmin(async sql => {
		for (const name of databasesOf(database, stack)) {
			const exists = (await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`).length > 0;
			if (exists && reset) await sql.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
			if (!exists || reset) await sql.unsafe(`CREATE DATABASE "${name}"`);
			await sql.unsafe(`COMMENT ON DATABASE "${name}" IS '${COMMENT_PREFIX}${worktree.replaceAll("'", "''")}'`);
		}
	});
}

export async function dropDatabases(database: string): Promise<void> {
	await withAdmin(async sql => {
		for (const name of STACKS.flatMap(stack => databasesOf(database, stack))) {
			await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		}
	});
}

export async function worktreeDatabases(): Promise<{ database: string; worktree: string }[]> {
	return withAdmin(async sql => {
		const rows = await sql<{ datname: string; comment: string | null }[]>`
			SELECT datname, shobj_description(oid, 'pg_database') AS comment FROM pg_database`;
		return rows
			.filter(
				row =>
					row.comment?.startsWith(COMMENT_PREFIX) &&
					!row.datname.endsWith('_powersync') &&
					!row.datname.endsWith('_e2e'),
			)
			.map(row => ({ database: row.datname, worktree: row.comment!.slice(COMMENT_PREFIX.length) }));
	});
}

function writeServiceConfig(worktree: string, database: string, stack: Stack): string {
	const template = readFileSync(join(root, 'powersync/local/service.template.yaml'), 'utf8');
	const dir = join(worktree, '.powersync');
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${stack}.yaml`);
	writeFileSync(file, template.replaceAll('{{DATABASE}}', `${database}${suffix(stack)}`));
	return file;
}

export async function startPowerSync(worktree: string, database: string, stack: Stack, port: number): Promise<void> {
	const name = containerName(worktree, stack);
	const project = name.replace('procrastimate-powersync-', 'procrastimate-');
	run(['docker', 'compose', '-f', compose, '-p', project, 'up', '-d', '--wait', 'powersync'], {
		WORKTREE: name.slice('procrastimate-powersync-'.length),
		WORKTREE_PATH: worktree,
		POWERSYNC_PORT: String(port),
		POWERSYNC_SERVICE_CONFIG: writeServiceConfig(worktree, database, stack),
	});
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		const alive = await fetch(`http://127.0.0.1:${port}/probes/liveness`).catch(() => null);
		if (alive?.ok) return;
		await Bun.sleep(500);
	}
	throw new Error(`PowerSync did not answer on port ${port} within 60 s. See \`docker logs ${name}\`.`);
}

export function stopPowerSync(worktree: string): void {
	for (const stack of STACKS) {
		spawnSync('docker', ['rm', '-f', containerName(worktree, stack)], { stdio: 'ignore' });
	}
}

export function powerSyncContainers(): { name: string; worktree: string }[] {
	const out = run([
		'docker',
		'ps',
		'-a',
		'--filter',
		`label=${WORKTREE_LABEL}`,
		'--format',
		`{{.Names}}\t{{.Label "${WORKTREE_LABEL}"}}`,
	]);
	return out
		.split('\n')
		.filter(Boolean)
		.map(line => {
			const [name, worktree] = line.split('\t');
			return { name: name!, worktree: worktree! };
		});
}

export function removeContainer(name: string): void {
	run(['docker', 'rm', '-f', name]);
}

export function readOverride(worktree: string): Record<string, string> | null {
	const file = join(worktree, '.env.override');
	if (!existsSync(file)) return null;
	return Object.fromEntries(
		readFileSync(file, 'utf8')
			.split('\n')
			.map(line => line.match(/^([A-Z0-9_]+)=(.*)$/))
			.filter((match): match is RegExpMatchArray => match !== null)
			.map(match => [match[1]!, match[2]!]),
	);
}
