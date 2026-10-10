import { describe, expect, test } from 'bun:test';
import { startSync } from './apply.ts';
import { opSchema, syncRequestSchema, syncResponseSchema } from './protocol.ts';
import { counter, MemoryServer, project, snapshotOf, task } from './testing.ts';

describe('protocol', () => {
	const local = snapshotOf({
		projects: [project('p', { sourceKey: 'todoist:project:1' })],
		tasks: [task('t', { projectId: 'p', recurrence: { interval: 1, unit: 'week', days: [1, 3] } })],
	});

	test('a request built from a diff parses as itself', () => {
		const request = { cursor: 0, ops: startSync(local, 'dev', 1, counter('op-')).outbox };
		expect(syncRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
	});

	test('both response shapes parse as themselves', () => {
		const server = new MemoryServer();
		const ops = startSync(local, 'dev', 1, counter('op-')).outbox;
		const first = server.sync(0, ops, 10);
		const next = server.sync(1, [], 20);
		expect(syncResponseSchema.parse(JSON.parse(JSON.stringify(first)))).toEqual(first);
		expect(syncResponseSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
	});

	test('rejects an op with an out-of-range clock or a bad field', () => {
		const op = { opId: 'o', hlc: '1:0:a', kind: 'task', id: 't', fields: { title: 'x' } };
		expect(opSchema.safeParse(op).success).toBe(true);
		expect(opSchema.safeParse({ ...op, hlc: `1:${2 ** 60}:a` }).success).toBe(false);
		expect(opSchema.safeParse({ ...op, fields: { priority: 7 } }).success).toBe(false);
		expect(opSchema.safeParse({ ...op, kind: 'note' }).success).toBe(false);
	});
});
