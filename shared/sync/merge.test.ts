import { describe, expect, test } from 'bun:test';
import { diff } from './diff.ts';
import { compareHlc, createClock, formatHlc, observe, tick } from './hlc.ts';
import {
	applyOps,
	applyPush,
	createServerState,
	entityKey,
	MAX_CLOCK_LEAD,
	serverHlc,
	serverSnapshot,
	type ServerState,
} from './merge.ts';
import { DEFAULT_SETTINGS, type Op, type Patch } from './protocol.ts';
import { MemoryClient, MemoryServer, project, snapshotOf, task } from './testing.ts';

const NOW = 1_000_000;

const created = (patch: Patch, opId: string, hlc: string): Op => ({ ...patch, opId, hlc });

const createTask = (id: string, hlc: string, fields = {}) =>
	created(diff(snapshotOf(), snapshotOf({ tasks: [task(id, fields)] }))[0]!, `create-${id}`, hlc);

const edit = (opId: string, hlc: string, id: string, fields: Op['fields']): Op =>
	({ opId, hlc, kind: 'task', id, fields }) as Op;

const apply = (state: ServerState, ops: Op[], applied = new Set<string>()) =>
	applyOps(state, ops, { now: NOW, isApplied: id => applied.has(id) });

const seeded = () => apply(createServerState(), [createTask('t', '10:0:a')]).state;

const issuedAfter = (returned: string, applied: string) =>
	compareHlc(formatHlc(tick(observe(createClock('client'), returned), 0)), applied) > 0;

const titleOf = (state: ServerState, id = 't') => serverSnapshot(state).tasks.find(t => t.id === id)?.title;

describe('applyOps', () => {
	test('creates an entity and logs every field', () => {
		const { state, acked, log } = apply(createServerState(), [createTask('t', '10:0:a')]);
		expect(acked).toEqual(['create-t']);
		expect(log[0]?.fields).toMatchObject({ deleted: false, title: 't', priority: 4 });
		expect(serverSnapshot(state).tasks).toEqual([task('t')]);
	});

	test('merges different fields from different devices', () => {
		const { state } = apply(seeded(), [
			edit('rename', '20:0:a', 't', { title: 'Renamed' }),
			edit('complete', '15:0:b', 't', { completedAt: 7 }),
		]);
		expect(serverSnapshot(state).tasks[0]).toMatchObject({ title: 'Renamed', completedAt: 7 });
	});

	test('keeps the newer write to the same field whatever order they arrive in', () => {
		const newer = edit('newer', '30:0:b', 't', { title: 'Newer' });
		const older = edit('older', '20:0:a', 't', { title: 'Older' });
		const first = apply(seeded(), [newer, older]);
		const second = apply(seeded(), [older, newer]);
		expect(titleOf(first.state)).toBe('Newer');
		expect(titleOf(second.state)).toBe('Newer');
		expect(first.log.map(e => [e.opId, e.fields])).toEqual([
			['newer', { title: 'Newer' }],
			['older', {}],
		]);
	});

	test('breaks a tie on wall time and counter by device', () => {
		const { state } = apply(seeded(), [
			edit('b', '20:0:b', 't', { title: 'From b' }),
			edit('a', '20:0:a', 't', { title: 'From a' }),
		]);
		expect(titleOf(state)).toBe('From b');
	});

	test('acknowledges a retried op without applying it again', () => {
		const rename = edit('rename', '20:0:a', 't', { title: 'Renamed' });
		const applied = new Set(['create-t', 'rename']);
		const retry = apply(seeded(), [rename], applied);
		expect(retry.acked).toEqual(['rename']);
		expect(retry.log).toEqual([]);
		const twice = apply(seeded(), [rename, rename]);
		expect(twice.acked).toEqual(['rename', 'rename']);
		expect(twice.log.map(e => e.opId)).toEqual(['rename']);
	});

	test('never lets a retried op with a clamped clock win again', () => {
		const ahead = edit('ahead', `${NOW + 10 * MAX_CLOCK_LEAD}:0:a`, 't', { title: 'Fast clock' });
		const first = apply(seeded(), [ahead]);
		const later = applyOps(first.state, [edit('honest', `${NOW + 1000}:0:b`, 't', { title: 'Honest' })], {
			now: NOW + 1000,
			isApplied: () => false,
		});
		const retried = applyOps(later.state, [ahead], { now: NOW + 2000, isApplied: id => id === 'ahead' });
		expect(titleOf(retried.state)).toBe('Honest');
	});

	test('clamps a clock more than a minute ahead to the server clock', () => {
		const ahead = edit('ahead', `${NOW + 10 * MAX_CLOCK_LEAD}:0:a`, 't', { title: 'Fast clock' });
		const { state } = apply(seeded(), [ahead, edit('honest', `${NOW + 1}:0:b`, 't', { title: 'Honest' })]);
		expect(titleOf(state)).toBe('Honest');
		const near = apply(seeded(), [edit('near', `${NOW + MAX_CLOCK_LEAD}:0:a`, 't', { title: 'Near' })]);
		expect(issuedAfter(serverHlc(near.state), `${NOW + MAX_CLOCK_LEAD}:0:a`)).toBe(true);
	});

	test('returns a clock that makes a client issue later ones than any it applied', () => {
		const { state } = apply(seeded(), [edit('e', '500:3:z', 't', { title: 'x' })]);
		expect(issuedAfter(serverHlc(state), '500:3:z')).toBe(true);
	});

	describe('delete vs edit', () => {
		test('drops an edit to a deleted task, even with a newer clock', () => {
			const { state, log } = apply(seeded(), [
				edit('delete', '20:0:a', 't', { deleted: true }),
				edit('late', '30:0:b', 't', { title: 'Late edit' }),
			]);
			expect(serverSnapshot(state).tasks).toEqual([]);
			expect(log.map(e => e.fields)).toEqual([{ deleted: true }, {}]);
		});

		test('keeps the delete when the edit arrives first', () => {
			const { state } = apply(seeded(), [
				edit('edit', '30:0:b', 't', { title: 'Edited' }),
				edit('delete', '20:0:a', 't', { deleted: true }),
			]);
			expect(serverSnapshot(state).tasks).toEqual([]);
		});

		test('undo of delete restores the task and logs all its fields', () => {
			const deleted = apply(seeded(), [edit('delete', '20:0:a', 't', { deleted: true })]).state;
			const restore = createTask('t', '30:0:a', { title: 'Back' });
			const { state, log } = apply(deleted, [{ ...restore, opId: 'undo' }]);
			expect(titleOf(state)).toBe('Back');
			expect(log[0]?.fields).toMatchObject({ deleted: false, title: 'Back', createdAt: 1, labelIds: [] });
		});

		test('an undelete older than the delete loses', () => {
			const deleted = apply(seeded(), [edit('delete', '20:0:a', 't', { deleted: true })]).state;
			const { state, log } = apply(deleted, [{ ...createTask('t', '15:0:b'), opId: 'stale' }]);
			expect(serverSnapshot(state).tasks).toEqual([]);
			expect(log.map(e => e.fields)).toEqual([{ deleted: true }]);
		});

		test('a delete older than an undelete loses and logs all the fields of the task that stays', () => {
			const restored = apply(seeded(), [
				edit('delete', '20:0:a', 't', { deleted: true }),
				{ ...createTask('t', '30:0:a'), opId: 'undo' },
				edit('rename', '40:0:c', 't', { title: 'Renamed' }),
			]).state;
			const { state, log } = apply(restored, [edit('stale', '25:0:b', 't', { deleted: true })]);
			expect(titleOf(state)).toBe('Renamed');
			expect(log[0]?.fields).toMatchObject({ deleted: false, title: 'Renamed', createdAt: 1, labelIds: [] });
		});

		test('a partial edit of an entity the server never had is dropped', () => {
			const { state, log } = apply(createServerState(), [edit('e', '20:0:a', 'ghost', { title: 'Ghost' })]);
			expect(serverSnapshot(state).tasks).toEqual([]);
			expect(log.map(e => e.fields)).toEqual([{}]);
		});

		test('an edit made while deleted stays dropped after an undelete', () => {
			const { state } = apply(seeded(), [
				edit('delete', '20:0:a', 't', { deleted: true }),
				edit('notes', '25:0:b', 't', { notes: 'Lost' }),
				edit('undo', '30:0:a', 't', { deleted: false }),
			]);
			expect(serverSnapshot(state).tasks[0]?.notes).toBe('');
		});
	});

	test('a recurring task completed on two devices advances once', () => {
		const repeating = createTask('t', '10:0:a', {
			recurrence: { interval: 1, unit: 'day' },
			due: { date: '2026-10-10', time: null },
		});
		const next = { due: { date: '2026-10-11' as const, time: null } };
		const { state } = apply(createServerState(), [
			repeating,
			edit('a', '20:0:a', 't', next),
			edit('b', '21:0:b', 't', next),
		]);
		expect(serverSnapshot(state).tasks[0]?.due).toEqual(next.due);
	});

	test('treats labelIds as one field, so one device’s set wins whole', () => {
		const { state } = apply(seeded(), [
			edit('a', '20:0:a', 't', { labelIds: ['work'] }),
			edit('b', '21:0:b', 't', { labelIds: ['home'] }),
		]);
		expect(serverSnapshot(state).tasks[0]?.labelIds).toEqual(['home']);
	});

	test('a label created before colors takes its name’s default color, and a color edit then wins', () => {
		const create: Op = {
			opId: 'l',
			hlc: '10:0:a',
			kind: 'label',
			id: 'l',
			fields: { deleted: false, name: 'urgent', createdAt: 1 },
		};
		const { state } = apply(createServerState(), [create]);
		expect(serverSnapshot(state).labels).toEqual([
			{ id: 'l', name: 'urgent', color: 'red', place: null, createdAt: 1 },
		]);
		const recolored = apply(state, [{ opId: 'c', hlc: '11:0:a', kind: 'label', id: 'l', fields: { color: 'teal' } }]);
		expect(serverSnapshot(recolored.state).labels[0]?.color).toBe('teal');
	});

	test('renaming a label stored before colors keeps the color every replica showed', () => {
		const stored: ServerState = {
			entities: new Map([
				[
					entityKey('label', 'l'),
					{
						kind: 'label',
						id: 'l',
						data: { deleted: false, name: 'urgent', createdAt: 1 },
						clocks: { deleted: '10:0:a', name: '10:0:a', createdAt: '10:0:a' },
					},
				],
			]),
			clock: createClock('server'),
		};
		expect(serverSnapshot(stored).labels[0]?.color).toBe('red');
		const { state, log } = apply(stored, [
			{ opId: 'r', hlc: '11:0:a', kind: 'label', id: 'l', fields: { name: 'tom' } },
		]);
		expect(log[0]?.fields).toEqual({ name: 'tom', color: 'red' });
		expect(serverSnapshot(state).labels).toEqual([{ id: 'l', name: 'tom', color: 'red', place: null, createdAt: 1 }]);
	});

	test('the settings record needs no create and cannot be deleted', () => {
		const { state } = apply(createServerState(), [
			{ opId: 's', hlc: '10:0:a', kind: 'settings', id: 'settings', fields: { timeZone: 'Asia/Tokyo' } },
			{ opId: 'd', hlc: '11:0:a', kind: 'settings', id: 'settings', fields: { deleted: true } },
		]);
		expect(serverSnapshot(state).settings).toEqual({ ...DEFAULT_SETTINGS, timeZone: 'Asia/Tokyo' });
	});
});

describe('applyPush', () => {
	test('writes fixups as server ops after the device’s ops', () => {
		const server = new MemoryServer();
		const a = new MemoryClient('a', snapshotOf({ projects: [project('p')], tasks: [task('t', { projectId: 'p' })] }));
		a.pull(server, NOW);
		const b = new MemoryClient('b');
		b.pull(server, NOW);
		a.run(s => ({ ...s, projects: [], tasks: [] }), NOW + 1);
		b.run(s => ({ ...s, tasks: [...s.tasks, task('moved', { projectId: 'p', createdAt: 2 })] }), NOW + 2);
		a.pull(server, NOW + 3);
		b.pull(server, NOW + 4);
		a.pull(server, NOW + 5);
		expect(server.snapshot.tasks).toEqual([task('moved', { createdAt: 2 })]);
		expect(server.log.at(-1)).toMatchObject({ opId: 'server-op-1', fields: { projectId: null } });
		expect(a.snapshot).toEqual(server.snapshot);
		expect(b.snapshot).toEqual(server.snapshot);
	});

	test('a fixup clock beats every op it repairs', () => {
		const { state } = applyPush(
			createServerState(),
			[created(diff(snapshotOf(), snapshotOf({ tasks: [task('child', { parentId: 'gone' })] }))[0]!, 'c', '90:0:a')],
			{ now: 50, isApplied: () => false },
		);
		expect(serverSnapshot(state).tasks[0]?.parentId).toBeNull();
		expect(compareHlc(state.entities.get(entityKey('task', 'child'))!.clocks.parentId!, '90:0:a')).toBeGreaterThan(0);
	});
});
