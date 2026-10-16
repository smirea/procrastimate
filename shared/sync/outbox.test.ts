import { expect } from 'bun:test';
import * as apply from './apply.ts';
import type { Op } from './protocol.ts';
import { createClock } from './hlc.ts';
import { counter, createOps, label, MemoryClient, MemoryServer, project, snapshotOf, task } from './testing.ts';
import { describe, recorded, test } from '../vectors/record.ts';

const enqueue = recorded('sync', apply.enqueue);
const seedPatches = recorded('sync', apply.seedPatches);
const settle = recorded('sync', apply.settle);
const rejectionNotice = recorded('sync', apply.rejectionNotice);

const op = (opId: string, hlc: string, fields: Op['fields'], id = 't'): Op =>
	({ opId, hlc, kind: 'task', id, fields }) as Op;

describe('enqueue', () => {
	test('keystrokes in a title before a sync leave one op with the last value', () => {
		const client = new MemoryClient('a', snapshotOf({ tasks: [task('t', { title: '' })] }));
		client.pull(new MemoryServer(), 1);
		for (const [i, title] of ['H', 'He', 'Hel', 'Hell', 'Hello'].entries()) {
			client.run(s => ({ ...s, tasks: [task('t', { title })] }), 10 + i);
		}
		expect(client.sync.outbox).toEqual([op('a-op-6', '14:0:a', { title: 'Hello' })]);
	});

	test('each field keeps the clock it was written at', () => {
		const outbox = enqueue(
			[op('1', '10:0:a', { title: 'Draft', completedAt: 10 })],
			[op('2', '20:0:a', { title: 'Final' }), op('3', '30:0:a', { notes: 'n' })],
		);
		expect(outbox).toEqual([
			op('1', '10:0:a', { completedAt: 10 }),
			op('2', '20:0:a', { title: 'Final' }),
			op('3', '30:0:a', { notes: 'n' }),
		]);
	});

	test('edits to an entity created since the last sync fold into its create under the newest id and clock', () => {
		const create = createOps(snapshotOf({ tasks: [task('t', { title: '' })] }), 'a', 10, counter('c-'))[0]!;
		const outbox = enqueue(
			[op('other', '5:0:a', { title: 'Other' }, 'u'), create],
			[op('2', '20:0:a', { title: 'Milk' }), op('3', '30:0:a', { priority: 1 })],
		);
		expect(outbox).toEqual([
			op('other', '5:0:a', { title: 'Other' }, 'u'),
			op('3', '30:0:a', { ...create.fields, title: 'Milk', priority: 1 }),
		]);
	});

	test('a delete replaces the edits queued for its entity, and an undo replaces the delete', () => {
		const deleted = enqueue(
			[op('1', '10:0:a', { title: 'x' }), op('2', '11:0:a', { title: 'y' }, 'u')],
			[op('3', '20:0:a', { deleted: true })],
		);
		expect(deleted).toEqual([op('2', '11:0:a', { title: 'y' }, 'u'), op('3', '20:0:a', { deleted: true })]);
		const restored = createOps(snapshotOf({ tasks: [task('t')] }), 'a', 30, counter('r-'))[0]!;
		expect(enqueue(deleted, [restored])).toEqual([op('2', '11:0:a', { title: 'y' }, 'u'), restored]);
	});

	test('settings ops coalesce by field like any other entity', () => {
		const settings = (opId: string, hlc: string, fields: Record<string, string>) =>
			({ opId, hlc, kind: 'settings', id: 'settings', fields }) as Op;
		expect(
			enqueue(
				[settings('1', '10:0:a', { timeZone: 'Europe/Paris', dictation: 'elevenlabs' })],
				[settings('2', '20:0:a', { dictation: 'native' })],
			),
		).toEqual([
			settings('1', '10:0:a', { timeZone: 'Europe/Paris' }),
			settings('2', '20:0:a', { dictation: 'native' }),
		]);
	});

	test('typing while a sync is in flight still lands the last value', () => {
		const server = new MemoryServer();
		const client = new MemoryClient('a', snapshotOf({ tasks: [task('t')] }));
		client.pull(server, 1);
		client.run(s => ({ ...s, tasks: [task('t', { title: 'Mi' })] }), 10);
		const response = server.sync(client.sync.cursor, client.sync.outbox, 11);
		client.run(s => ({ ...s, tasks: [task('t', { title: 'Milk' })] }), 12);
		expect(client.sync.outbox.map(o => o.fields)).toEqual([{ title: 'Milk' }]);
		({ snapshot: client.snapshot, sync: client.sync } = apply.applyResponse(
			client.snapshot,
			client.sync,
			response,
			13,
		));
		expect(client.snapshot.tasks[0]?.title).toBe('Milk');
		client.pull(server, 14);
		expect(server.snapshot.tasks[0]?.title).toBe('Milk');
		expect(client.sync.outbox).toEqual([]);
	});
});

describe('first sync', () => {
	const shared = snapshotOf({
		projects: [project('p')],
		labels: [label('l')],
		tasks: [task('t1', { projectId: 'p', labelIds: ['l'] }), task('t2', { createdAt: 2 })],
	});

	test('with a server that already has the same tasks pushes no ops', () => {
		const server = new MemoryServer();
		new MemoryClient('a', shared).pull(server, 10);
		const before = server.log.length;
		expect(seedPatches(server.snapshot, shared)).toEqual([]);
		const b = new MemoryClient('b', shared);
		b.pull(server, 20);
		expect(server.log.length).toBe(before);
		expect(b.sync).toMatchObject({ outbox: [], seed: false, cursor: before });
		expect(b.snapshot).toEqual(server.snapshot);
	});

	test('queues only what the server lacks or holds differently, and keeps the server’s settings', () => {
		const server = snapshotOf({
			projects: [project('p')],
			tasks: [task('t1', { projectId: 'p' }), task('theirs', { createdAt: 3 })],
			settings: { dictation: 'elevenlabs' },
		});
		const local = snapshotOf({
			projects: [project('p')],
			labels: [label('mine')],
			tasks: [task('t1', { projectId: 'p', title: 'Renamed offline' })],
			settings: { timeZone: 'Europe/Paris' },
		});
		expect(seedPatches(server, local)).toEqual([
			{ kind: 'label', id: 'mine', fields: { deleted: false, name: 'mine', createdAt: 1 } },
			{ kind: 'task', id: 't1', fields: { title: 'Renamed offline' } },
		]);
	});

	test('a seeded device uploads its own data in the round right after the snapshot', () => {
		const server = new MemoryServer();
		new MemoryClient('a', shared).pull(server, 10);
		const b = new MemoryClient('b', snapshotOf({ ...shared, tasks: [...shared.tasks, task('new', { createdAt: 5 })] }));
		b.pull(server, 20);
		expect(server.log.filter(change => change.opId.startsWith('b-')).map(change => [change.kind, change.id])).toEqual([
			['task', 'new'],
		]);
		expect(b.snapshot).toEqual(server.snapshot);
		expect(server.snapshot.tasks.map(t => t.id)).toEqual(['t1', 't2', 'new']);
	});

	test('a device that missed a delete-all takes the wiped snapshot and uploads nothing', () => {
		const b = new MemoryClient('b', shared);
		const wiped = { acked: [], rejected: [], snapshot: snapshotOf(), cursor: 0, hlc: '30:0:server', epoch: 1 };
		const { snapshot, sync } = apply.applyResponse(b.snapshot, b.sync, wiped, 40);
		expect(snapshot).toEqual(snapshotOf());
		expect(sync).toMatchObject({ outbox: [], seed: false, epoch: 1 });
	});
});

describe('rejected ops', () => {
	const edit = op('edit', '20:0:a', { title: 'Renamed' });
	const bad = op('bad', '21:0:a', { title: 'Refused', due: { date: '12784-10-19', time: null } } as Op['fields']);
	const later = op('later', '22:0:a', { notes: 'n' }, 'u');

	test('a batch with one invalid op drops the acked ones and that one, and keeps the rest waiting', () => {
		expect(settle([edit, bad, later], ['edit'], [{ opId: 'bad', reason: 'fields.due.date: Invalid input' }])).toEqual({
			outbox: [later],
			rejected: [bad],
		});
	});

	test('the rejected op leaves the outbox and its entity takes the server value from the snapshot', () => {
		const local = snapshotOf({ tasks: [task('t', { title: 'Refused' }), task('u', { createdAt: 2 })] });
		const sync = { cursor: 4, outbox: [bad, later], clock: createClock('a'), epoch: 0, seed: false };
		const server = snapshotOf({ tasks: [task('t', { title: 'Saved' }), task('u', { createdAt: 2 })] });
		const response = {
			acked: [],
			rejected: [{ opId: 'bad', reason: 'fields.due.date: Invalid input' }],
			snapshot: server,
			cursor: 5,
			hlc: '30:0:server',
			epoch: 0,
		};
		const applied = apply.applyResponse(local, sync, response, 40);
		expect(applied.rejected).toEqual([bad]);
		expect(applied.sync.outbox).toEqual([later]);
		expect(applied.snapshot.tasks.map(t => [t.title, t.notes, t.due])).toEqual([
			['Saved', '', null],
			['u', 'n', null],
		]);
		expect(rejectionNotice(local, applied.rejected)).toBe('Couldn’t save a change to “Refused”');
	});

	test('the notice names the one entity it refused, or counts them', () => {
		const local = snapshotOf({ tasks: [task('t', { title: 'Milk' })], projects: [project('p', { name: 'Home' })] });
		const projectOp = { opId: 'p1', hlc: '1:0:a', kind: 'project', id: 'p', fields: { name: '' } } as Op;
		const comment = { opId: 'c1', hlc: '1:0:a', kind: 'comment', id: 'c', fields: { body: '' } } as Op;
		expect(rejectionNotice(local, [])).toBeNull();
		expect(rejectionNotice(local, [projectOp])).toBe('Couldn’t save a change to “Home”');
		expect(rejectionNotice(local, [comment])).toBe('Couldn’t save a change');
		expect(rejectionNotice(local, [bad, { ...edit, id: 't', opId: 'again' }])).toBe('Couldn’t save a change to “Milk”');
		expect(rejectionNotice(local, [bad, projectOp, comment])).toBe('Couldn’t save changes to 3 items');
	});
});
