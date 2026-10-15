import { describe, expect, test } from 'bun:test';
import type { Device } from './store';
import { storeFactories } from './test-stores';

const device = (id: string, createdAt: number): Device => ({
	id,
	name: `Device ${id}`,
	tokenHash: `hash-${id}`,
	createdAt,
	lastSeenAt: createdAt,
	revokedAt: null,
});

describe.each(storeFactories)('%s store', (_name, createStore) => {
	test('finds devices by token hash, lists live ones oldest first, and revokes once', () => {
		const store = createStore();
		store.addDevice(device('b', 2));
		store.addDevice(device('a', 1));
		expect(store.deviceByTokenHash('hash-b')?.id).toBe('b');
		expect(store.deviceByTokenHash('missing')).toBeNull();
		store.touchDevice('a', 50);
		expect(store.liveDevices().map(d => [d.id, d.lastSeenAt])).toEqual([
			['a', 50],
			['b', 2],
		]);
		expect(store.revokeDevice('a', 60)).toBe(true);
		expect(store.revokeDevice('a', 70)).toBe(false);
		expect(store.revokeDevice('missing', 70)).toBe(false);
		expect(store.liveDevices().map(d => d.id)).toEqual(['b']);
		expect(store.deviceByTokenHash('hash-a')?.revokedAt).toBe(60);
	});

	test('wipes task data and bumps the epoch without dropping devices', () => {
		const store = createStore();
		store.addDevice(device('a', 1));
		store.putEntity({ kind: 'task', id: '1', data: { title: 'A' }, clocks: { title: '1:0:device' } });
		store.appendLog({ opId: 'op', kind: 'task', id: '1', fields: { title: 'A' }, actor: 'user', at: 1 });
		expect(store.epoch()).toBe(0);
		store.clearTaskData();
		store.setEpoch(store.epoch() + 1);
		expect(store.entities()).toEqual([]);
		expect(store.lastSeq()).toBe(0);
		expect(store.hasOp('op')).toBe(false);
		expect(store.epoch()).toBe(1);
		expect(store.liveDevices().map(d => d.id)).toEqual(['a']);
	});

	test('stores entities as JSON and replaces them by kind and id', () => {
		const store = createStore();
		store.putEntity({ kind: 'task', id: '1', data: { title: 'A' }, clocks: { title: '1:0:x' } });
		store.putEntity({ kind: 'task', id: '1', data: { title: 'B' }, clocks: { title: '2:0:x' } });
		store.putEntity({ kind: 'label', id: '1', data: { name: 'L' }, clocks: { name: '1:0:device' } });
		expect(store.entity('task', '1')).toEqual({
			kind: 'task',
			id: '1',
			data: { title: 'B' },
			clocks: { title: '2:0:x' },
		});
		expect(store.entity('project', '1')).toBeNull();
		expect(store.entities()).toHaveLength(2);
	});

	test('appends log rows with increasing seq and pages after a cursor', () => {
		const store = createStore();
		expect(store.lastSeq()).toBe(0);
		const seqs = ['a', 'b', 'c'].map(opId =>
			store.appendLog({ opId, kind: 'task', id: opId, fields: { n: opId }, actor: 'user', at: 1 }),
		);
		expect(seqs).toEqual([1, 2, 3]);
		expect(store.lastSeq()).toBe(3);
		expect(store.logAfter(1, 1)).toEqual([
			{ seq: 2, opId: 'b', kind: 'task', id: 'b', fields: { n: 'b' }, actor: 'user', at: 1 },
		]);
		expect(store.logAfter(3, 10)).toEqual([]);
		expect(store.hasOp('c')).toBe(true);
		expect(store.hasOp('d')).toBe(false);
	});

	test('hands out copies, not references', () => {
		const store = createStore();
		const data = { title: 'A' };
		store.putEntity({ kind: 'task', id: '1', data, clocks: { title: '1:0:device' } });
		data.title = 'changed';
		expect(store.entity('task', '1')?.data).toEqual({ title: 'A' });
	});

	test('adds up Ramble seconds per day', () => {
		const store = createStore();
		expect(store.rambleSeconds('2026-10-14')).toBe(0);
		store.addRambleSeconds('2026-10-14', 12.5);
		store.addRambleSeconds('2026-10-14', 30);
		store.addRambleSeconds('2026-10-15', 1);
		expect(store.rambleSeconds('2026-10-14')).toBe(42.5);
		expect(store.rambleSeconds('2026-10-15')).toBe(1);
	});

	test('keeps shares, memberships, people, and API tokens until the account is dropped', () => {
		const store = createStore();
		store.putShare({ id: 's2', targetKind: 'project', targetId: 'p', grantee: 'u2', role: 'edit', createdAt: 2 });
		store.putShare({ id: 's1', targetKind: 'task', targetId: 't', grantee: null, role: 'view', createdAt: 2 });
		store.putShare({ id: 's2', targetKind: 'project', targetId: 'p', grantee: 'u2', role: 'view', createdAt: 2 });
		store.deleteShare('missing');
		expect(store.shares().map(share => [share.id, share.role])).toEqual([
			['s1', 'view'],
			['s2', 'view'],
		]);
		store.deleteShare('s1');
		expect(store.shares().map(share => share.id)).toEqual(['s2']);

		store.putMembership({ spaceId: 'owner-b', createdAt: 5 });
		store.putMembership({ spaceId: 'owner-a', createdAt: 9 });
		store.deleteMembership('owner-b');
		expect(store.memberships()).toEqual([{ spaceId: 'owner-a', createdAt: 9 }]);

		store.upsertPerson({ id: 'u2', name: 'Ana', kind: 'human', ownerId: null, seenAt: 1 });
		store.upsertPerson({ id: 'ai', name: 'Helper', kind: 'ai', ownerId: 'u1', seenAt: 1 });
		store.upsertPerson({ id: 'u2', name: 'Ana B', kind: 'human', ownerId: null, seenAt: 7 });
		expect(store.people().map(person => [person.id, person.name, person.seenAt])).toEqual([
			['ai', 'Helper', 1],
			['u2', 'Ana B', 7],
		]);

		store.putApiToken({ id: 'k1', aiUserId: 'ai', name: 'CLI', tokenHash: 'h1', createdAt: 3, lastUsedAt: null });
		store.putApiToken({ id: 'k2', aiUserId: 'ai', name: 'Bot', tokenHash: 'h2', createdAt: 4, lastUsedAt: null });
		store.touchApiToken('k1', 30);
		expect(store.apiTokenByHash('h1')).toEqual({
			id: 'k1',
			aiUserId: 'ai',
			name: 'CLI',
			tokenHash: 'h1',
			createdAt: 3,
			lastUsedAt: 30,
		});
		expect(store.apiTokenByHash('missing')).toBeNull();
		store.deleteApiToken('k2');
		expect(store.apiTokens().map(token => token.id)).toEqual(['k1']);

		store.clearTaskData();
		expect([store.shares().length, store.memberships().length, store.people().length]).toEqual([1, 1, 2]);
		store.clearAccount();
		expect([store.shares(), store.memberships(), store.people(), store.apiTokens()]).toEqual([[], [], [], []]);
	});
});
