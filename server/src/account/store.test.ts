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

	test('keeps one pairing code, replaced or cleared', () => {
		const store = createStore();
		expect(store.pairing()).toBeNull();
		store.setPairing({ codeHash: 'one', expiresAt: 10, attempts: 0 });
		store.setPairing({ codeHash: 'two', expiresAt: 20, attempts: 1 });
		expect(store.pairing()).toEqual({ codeHash: 'two', expiresAt: 20, attempts: 1 });
		store.setPairing(null);
		expect(store.pairing()).toBeNull();
	});

	test('stores entities as JSON and replaces them by kind and id', () => {
		const store = createStore();
		store.putEntity({ kind: 'task', id: '1', data: { title: 'A' }, clocks: { title: '1:0:x' } });
		store.putEntity({ kind: 'task', id: '1', data: { title: 'B' }, clocks: { title: '2:0:x' } });
		store.putEntity({ kind: 'label', id: '1', data: { name: 'L' }, clocks: {} });
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
		const seqs = ['a', 'b', 'c'].map(opId => store.appendLog({ opId, kind: 'task', id: opId, fields: { n: opId } }));
		expect(seqs).toEqual([1, 2, 3]);
		expect(store.lastSeq()).toBe(3);
		expect(store.logAfter(1, 1)).toEqual([{ seq: 2, opId: 'b', kind: 'task', id: 'b', fields: { n: 'b' } }]);
		expect(store.logAfter(3, 10)).toEqual([]);
		expect(store.hasOp('c')).toBe(true);
		expect(store.hasOp('d')).toBe(false);
	});

	test('hands out copies, not references', () => {
		const store = createStore();
		const data = { title: 'A' };
		store.putEntity({ kind: 'task', id: '1', data, clocks: {} });
		data.title = 'changed';
		expect(store.entity('task', '1')?.data).toEqual({ title: 'A' });
	});
});
