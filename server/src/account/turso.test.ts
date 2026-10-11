import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import type { Client, InStatement, ResultSet } from '@libsql/client/web';
import { accountSession } from './turso';

/** A libSQL client over `bun:sqlite`, so a session can round-trip without Turso. */
function sqliteClient(): Client {
	const db = new Database(':memory:', { strict: true });
	const run = (statement: InStatement) => {
		const sql = typeof statement === 'string' ? statement : statement.sql;
		const args = typeof statement === 'string' ? [] : (statement.args ?? []);
		const query = db.query(sql);
		const rows = sql.trimStart().toUpperCase().startsWith('SELECT')
			? query.all(...(args as SQLQueryBindings[]))
			: (query.run(...(args as SQLQueryBindings[])), []);
		return { rows } as unknown as ResultSet;
	};
	const client: Pick<Client, 'execute' | 'executeMultiple' | 'batch'> = {
		execute: statement => Promise.resolve(run(statement)),
		executeMultiple: async sql => {
			db.exec(sql);
		},
		batch: async statements => statements.map(statement => run(statement as InStatement)),
	};
	return client as Client;
}

describe('a Turso session', () => {
	test('loads what the last flush wrote, including a wiped epoch', async () => {
		const client = sqliteClient();
		const first = await accountSession(client);
		first.store.addDevice({
			id: 'mac',
			name: 'Mac',
			tokenHash: 'hash',
			createdAt: 1,
			lastSeenAt: 1,
			revokedAt: null,
		});
		first.store.putEntity({ kind: 'task', id: 't1', data: { title: 'Buy milk' }, clocks: { title: '1:0:mac' } });
		first.store.appendLog({ opId: 'op-1', kind: 'task', id: 't1', fields: { title: 'Buy milk' } });
		first.store.setEpoch(2);
		await first.flush();

		const second = await accountSession(client);
		expect(second.store.liveDevices().map(device => device.id)).toEqual(['mac']);
		expect(second.store.entities()).toEqual([
			{ kind: 'task', id: 't1', data: { title: 'Buy milk' }, clocks: { title: '1:0:mac' } },
		]);
		expect(second.store.logAfter(0, 10)).toEqual([
			{ seq: 1, opId: 'op-1', kind: 'task', id: 't1', fields: { title: 'Buy milk' } },
		]);
		expect(second.store.epoch()).toBe(2);

		second.store.clearTaskData();
		second.store.setEpoch(3);
		await second.flush();

		const third = await accountSession(client);
		expect(third.store.entities()).toEqual([]);
		expect(third.store.lastSeq()).toBe(0);
		expect(third.store.liveDevices()).toHaveLength(1);
		expect(third.store.epoch()).toBe(3);
	});
});
