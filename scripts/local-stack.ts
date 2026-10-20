import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
// Loaded where it connects: `setup-worktree.ts` imports this file before its `bun install` has run in a new worktree.
import type postgres from 'postgres';
import { run as runCommand } from './lib';

const connectTo = async (url: string) => (await import('postgres')).default(url, { max: 1, onnotice: () => {} });

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

/** One stack per worktree serves `bun run start` and the API server Playwright starts alike. */
const containerName = (worktree: string) => `procrastimate-powersync-${worktreeKey(worktree)}`;

const run = (cmd: string[], env?: Record<string, string>) => runCommand(cmd, { env });

export function dockerRunning(): boolean {
	return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

export function requireDocker(): void {
	if (dockerRunning()) return;
	throw new Error('Docker is not running. Start Docker Desktop (or `colima start`), then rerun this script.');
}

/**
 * `--no-recreate` because every worktree shares this container: a compose change would otherwise make the next
 * worktree setup recreate it under every other worktree's running servers.
 */
export function ensurePostgres(): void {
	run(['docker', 'compose', '-f', compose, '-p', 'procrastimate', 'up', '-d', '--wait', '--no-recreate', 'postgres']);
}

async function withAdmin<T>(use: (sql: postgres.Sql) => Promise<T>): Promise<T> {
	const sql = await connectTo(ADMIN_URL);
	try {
		return await use(sql);
	} finally {
		await sql.end();
	}
}

const databasesOf = (database: string) => [database, `${database}_powersync`];

/** A replication slot outlives its PowerSync container and blocks `DROP DATABASE`, so it goes first. */
async function dropDatabase(sql: postgres.Sql, name: string): Promise<void> {
	await sql`SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE database = ${name}`;
	await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}

export async function ensureDatabases(database: string, worktree: string, reset = false): Promise<void> {
	await withAdmin(async sql => {
		for (const name of databasesOf(database)) {
			const exists = (await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`).length > 0;
			if (exists && reset) await dropDatabase(sql, name);
			if (!exists || reset) await sql.unsafe(`CREATE DATABASE "${name}"`);
			await sql.unsafe(`COMMENT ON DATABASE "${name}" IS '${COMMENT_PREFIX}${worktree.replaceAll("'", "''")}'`);
		}
	});
}

export async function dropDatabases(database: string): Promise<void> {
	await withAdmin(async sql => {
		for (const name of databasesOf(database)) await dropDatabase(sql, name);
	});
}

export async function worktreeDatabases(): Promise<{ database: string; worktree: string }[]> {
	return withAdmin(async sql => {
		const rows = await sql<{ datname: string; comment: string | null }[]>`
			SELECT datname, shobj_description(oid, 'pg_database') AS comment FROM pg_database`;
		return rows
			.filter(row => row.comment?.startsWith(COMMENT_PREFIX) && !row.datname.endsWith('_powersync'))
			.map(row => ({ database: row.datname, worktree: row.comment!.slice(COMMENT_PREFIX.length) }));
	});
}

export type ReplicationSlot = { name: string; database: string; active: boolean; held: string };

export async function replicationSlots(): Promise<ReplicationSlot[]> {
	return withAdmin(
		sql => sql<ReplicationSlot[]>`
			SELECT slot_name AS name, database, active,
				pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS held
			FROM pg_replication_slots ORDER BY slot_name`,
	);
}

/** Skips the slot if a PowerSync took it up since it was listed: Postgres refuses to drop an active slot anyway. */
export async function dropInactiveSlot(name: string): Promise<void> {
	await withAdmin(
		sql =>
			sql`SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = ${name} AND NOT active`,
	);
}

function writeServiceConfig(worktree: string, database: string): string {
	const template = readFileSync(join(root, 'powersync/local/service.template.yaml'), 'utf8');
	const dir = join(worktree, '.powersync');
	mkdirSync(dir, { recursive: true });
	const file = join(dir, 'service.yaml');
	writeFileSync(file, template.replaceAll('{{DATABASE}}', database));
	return file;
}

/**
 * PowerSync answers `No sync config available` until it has replicated the publication, which the app's migrations
 * create. In Worker mode those run on the first request, so a run that started its tests at once lost its first
 * syncs. So the stack migrates first and waits for the replication stream before anything uses it.
 */
async function migrateApp(database: string): Promise<void> {
	const { connect } = await import('../server/src/db/postgres');
	const { migrate } = await import('../server/src/db/migrate');
	const connection = connect(databaseUrl(database));
	try {
		await migrate(connection.db);
	} finally {
		await connection.end();
	}
}

/** PowerSync marks its sync config `ACTIVE` in its storage database once the first replication finished. */
async function waitForReplication(name: string, storage: string): Promise<void> {
	const sql = await connectTo(databaseUrl(storage));
	try {
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			const active = await sql`SELECT 1 FROM powersync.sync_rules WHERE state = 'ACTIVE'`.catch(() => []);
			if (active.length) return;
			await Bun.sleep(500);
		}
	} finally {
		await sql.end();
	}
	throw new Error(`PowerSync did not start replicating within 60 s. See \`docker logs ${name}\`.`);
}

export async function startPowerSync(worktree: string, database: string, port: number): Promise<void> {
	await migrateApp(database);
	const name = containerName(worktree);
	const project = name.replace('procrastimate-powersync-', 'procrastimate-');
	run(['docker', 'compose', '-f', compose, '-p', project, 'up', '-d', '--wait', 'powersync'], {
		WORKTREE: name.slice('procrastimate-powersync-'.length),
		WORKTREE_PATH: worktree,
		POWERSYNC_PORT: String(port),
		POWERSYNC_SERVICE_CONFIG: writeServiceConfig(worktree, database),
	});
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		const alive = await fetch(`http://127.0.0.1:${port}/probes/liveness`).catch(() => null);
		if (alive?.ok) return waitForReplication(name, `${database}_powersync`);
		await Bun.sleep(500);
	}
	throw new Error(`PowerSync did not answer on port ${port} within 60 s. See \`docker logs ${name}\`.`);
}

export function stopPowerSync(worktree: string): void {
	spawnSync('docker', ['rm', '-f', containerName(worktree)], { stdio: 'ignore' });
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

export { readOverride } from './lib';
