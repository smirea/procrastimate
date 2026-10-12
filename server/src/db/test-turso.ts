import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type TursoDatabase } from './turso';

/** `beforeBatch` runs before every batch, so a test can hold a flush mid-flight. */
export type ClientHooks = { beforeBatch?: () => Promise<void>; onTransaction?: () => void };

/** A real libSQL database in a temporary file, standing in for Turso. */
export function localClient(hooks?: ClientHooks): Client {
	const client = createClient({ url: `file:${join(tmpdir(), `procrastimate-${crypto.randomUUID()}.db`)}` });
	const held = new Proxy(client, {
		get(target, key: keyof Client) {
			const value = target[key];
			if (typeof value !== 'function') return value;
			if (key === 'transaction') {
				return (...args: Parameters<Client['transaction']>) => {
					hooks?.onTransaction?.();
					return target.transaction(...args);
				};
			}
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
export async function localTurso(hooks?: ClientHooks): Promise<TursoDatabase> {
	let armed = false;
	const db = await openDatabase(
		localClient({
			beforeBatch: async () => (armed ? hooks?.beforeBatch?.() : undefined),
			onTransaction: () => armed && hooks?.onTransaction?.(),
		}),
	);
	armed = true;
	return db;
}
