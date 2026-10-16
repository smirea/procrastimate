import { describe, expect, test } from 'bun:test';
import { applyChanges, applyResponse, commit, replayOutbox } from './apply.ts';
import { diff, stamp } from './diff.ts';
import { createClock } from './hlc.ts';
import { DEFAULT_SETTINGS, type Change } from './protocol.ts';
import { counter, label, MemoryClient, MemoryServer, project, snapshotOf, task } from './testing.ts';

const change = (seq: number, fields: Change['fields'], id = 't'): Change =>
	({ seq, opId: `op-${seq}`, kind: 'task', id, fields }) as Change;

const full = (id: string, fields = {}) => diff(snapshotOf(), snapshotOf({ tasks: [task(id, fields)] }))[0]!.fields;

describe('applyChanges', () => {
	test('writes partial changes onto what the client has', () => {
		const result = applyChanges(snapshotOf({ tasks: [task('t')] }), [
			change(1, { title: 'A' }),
			change(2, { notes: 'B' }),
		]);
		expect(result.tasks).toEqual([task('t', { title: 'A', notes: 'B' })]);
	});

	test('builds an entity from a full change and removes one on a tombstone', () => {
		const added = applyChanges(snapshotOf(), [change(1, full('t', { sourceKey: 'k' }))]);
		expect(added.tasks).toEqual([task('t', { sourceKey: 'k' })]);
		expect(applyChanges(added, [change(2, { deleted: true })]).tasks).toEqual([]);
	});

	test('a project from a build before ordering arrives at order 0', () => {
		const old = {
			seq: 1,
			opId: 'op-1',
			kind: 'project',
			id: 'p',
			fields: { deleted: false, name: 'p', createdAt: 1, sourceKey: null },
		};
		expect(applyChanges(snapshotOf(), [old as Change]).projects).toEqual([project('p')]);
	});

	test('skips a partial change for an entity the client does not have', () => {
		expect(applyChanges(snapshotOf(), [change(1, { title: 'Ghost' })]).tasks).toEqual([]);
	});

	test('skips a change that would make the entity invalid', () => {
		const before = snapshotOf({ tasks: [task('t')] });
		expect(applyChanges(before, [change(1, { priority: 9 } as never)])).toEqual(before);
	});

	test('keeps tasks sorted by creation, then id', () => {
		const result = applyChanges(snapshotOf({ tasks: [task('b', { createdAt: 2 })] }), [
			change(1, full('c', { createdAt: 1 }), 'c'),
			change(2, full('a', { createdAt: 2 }), 'a'),
		]);
		expect(result.tasks.map(t => t.id)).toEqual(['c', 'a', 'b']);
	});

	test('updates the settings record', () => {
		const result = applyChanges(snapshotOf(), [
			{ seq: 1, opId: 's', kind: 'settings', id: 'settings', fields: { timeZone: 'Europe/Paris' } },
		]);
		expect(result.settings).toEqual({ ...DEFAULT_SETTINGS, timeZone: 'Europe/Paris' });
	});
});

describe('replayOutbox', () => {
	test('reapplies unacknowledged ops, including a pending delete', () => {
		const before = snapshotOf({ tasks: [task('a'), task('b')] });
		const after = snapshotOf({ tasks: [task('a', { title: 'Pending' })] });
		const { ops } = stamp(diff(before, after), createClock('dev'), 1, counter('op-'));
		expect(replayOutbox(before, ops)).toEqual(after);
	});
});

describe('applyResponse', () => {
	test('keeps an edit made while the request was in flight', () => {
		const server = new MemoryServer();
		const client = new MemoryClient('a', snapshotOf({ tasks: [task('t')] }));
		client.pull(server, 10);
		client.run(s => ({ ...s, tasks: [task('t', { title: 'Sent' })] }), 20);
		const response = server.sync(client.sync.cursor, client.sync.outbox, 21);
		client.run(s => ({ ...s, tasks: [task('t', { title: 'Typed meanwhile' })] }), 22);
		const { snapshot, sync } = applyResponse(client.snapshot, client.sync, response, 23);
		expect(snapshot.tasks[0]?.title).toBe('Typed meanwhile');
		expect(sync.outbox.map(op => op.fields)).toEqual([{ title: 'Typed meanwhile' }]);
		expect(sync.cursor).toBe(server.log.length);
	});

	test('a wipe on another device drops the outbox, and the device that reset keeps an in-flight edit', () => {
		const clock = createClock('a');
		const during = commit(
			{ cursor: 0, outbox: [], clock, epoch: 0, seed: false },
			snapshotOf(),
			snapshotOf({ tasks: [task('n', { title: 'After' })] }),
			30,
			counter('new-'),
		);
		const response = {
			acked: [] as string[],
			rejected: [],
			snapshot: snapshotOf(),
			cursor: 0,
			hlc: '30:0:server',
			epoch: 1,
		};
		const kept = applyResponse(snapshotOf({ tasks: [task('n', { title: 'After' })] }), during, response, 31, {
			sentReset: true,
		});
		expect(kept.snapshot.tasks.map(t => t.title)).toEqual(['After']);
		expect(kept.sync.epoch).toBe(1);
		expect(kept.sync.outbox.map(op => op.id)).toEqual(['n']);

		const dropped = applyResponse(snapshotOf({ tasks: [task('t', { title: 'Local' })] }), during, response, 31);
		expect(dropped.sync.outbox).toEqual([]);
		expect(dropped.snapshot.tasks).toEqual([]);
	});

	test('moves the client clock up to the server’s', () => {
		const server = new MemoryServer();
		const fast = new MemoryClient('fast', snapshotOf({ tasks: [task('t')] }));
		fast.run(s => ({ ...s, tasks: [task('t', { title: 'x' })] }), 5000);
		fast.pull(server, 5000);
		const slow = new MemoryClient('slow');
		slow.pull(server, 10);
		expect(slow.sync.clock.wall).toBe(5000);
	});
});

describe('first sync', () => {
	test('two devices with local data add up, and their shared imports and names merge', () => {
		const server = new MemoryServer();
		const a = new MemoryClient(
			'a',
			snapshotOf({
				projects: [project('pa', { name: 'Imported', sourceKey: 'todoist:project:1', createdAt: 1 })],
				labels: [label('la', { name: 'Work', createdAt: 1 })],
				tasks: [task('ta', { title: 'Milk', projectId: 'pa', sourceKey: 'todoist:task:1', labelIds: ['la'] })],
			}),
		);
		const b = new MemoryClient(
			'b',
			snapshotOf({
				projects: [project('pb', { name: 'Imported', sourceKey: 'todoist:project:1', createdAt: 2 })],
				labels: [label('lb', { name: 'work', createdAt: 2 })],
				tasks: [
					task('tb', { title: 'Milk', projectId: 'pb', sourceKey: 'todoist:task:1', labelIds: ['lb'], createdAt: 2 }),
					task('typed', { title: 'Milk', labelIds: ['lb'], createdAt: 2 }),
				],
			}),
		);
		a.pull(server, 10);
		b.pull(server, 20);
		a.pull(server, 30);
		expect(server.snapshot).toEqual(
			snapshotOf({
				projects: [project('pa', { name: 'Imported', sourceKey: 'todoist:project:1', createdAt: 1 })],
				labels: [label('la', { name: 'Work', createdAt: 1 })],
				tasks: [
					task('ta', { title: 'Milk', projectId: 'pa', sourceKey: 'todoist:task:1', labelIds: ['la'] }),
					task('typed', { title: 'Milk', labelIds: ['la'], createdAt: 2 }),
				],
			}),
		);
		expect(a.snapshot).toEqual(server.snapshot);
		expect(b.snapshot).toEqual(server.snapshot);
	});
});
