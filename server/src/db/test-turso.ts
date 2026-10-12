import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type TursoDatabase } from './turso';

/**
 * A real libSQL database in a temporary file, standing in for Turso. `beforeBatch` runs before every batch, so a
 * test can hold a flush mid-flight.
 */
export function localClient(hooks?: { beforeBatch?: () => Promise<void> }): Client {
	const client = createClient({ url: `file:${join(tmpdir(), `procrastimate-${crypto.randomUUID()}.db`)}` });
	const held = new Proxy(client, {
		get(target, key: keyof Client) {
			const value = target[key];
			if (typeof value !== 'function') return value;
			if (key !== 'batch') return value.bind(target);
			return async (...args: Parameters<Client['batch']>) => {
				await hooks?.beforeBatch?.();
				return target.batch(...args);
			};
		},
	});
	return held as Client;
}

/** Migrated before `beforeBatch` is armed, so the hook sees only the test's own batches. */
export async function localTurso(hooks?: { beforeBatch?: () => Promise<void> }): Promise<TursoDatabase> {
	let armed = false;
	const db = await openDatabase(localClient({ beforeBatch: async () => (armed ? hooks?.beforeBatch?.() : undefined) }));
	armed = true;
	return db;
}
