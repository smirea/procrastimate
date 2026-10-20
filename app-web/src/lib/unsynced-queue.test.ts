import { expect, test } from 'bun:test';
import { UnsyncedQueue } from './unsynced-queue.ts';

function queue(online = true) {
	const graces: (() => void)[] = [];
	const state = { online };
	const unsynced = new UnsyncedQueue(
		new Set(),
		ripen => graces.push(ripen),
		() => state.online,
	);
	return { unsynced, graces, state };
}

test('online, a queued write shows only once its grace runs out, and leaves with the write', () => {
	const { unsynced, graces } = queue();
	unsynced.read([{ id: 'milk', row: 1 }]);
	expect([...unsynced.shown]).toEqual([]);

	graces[0]!();
	expect([...unsynced.shown]).toEqual(['milk']);
	unsynced.read([]);
	expect([...unsynced.shown]).toEqual([]);
});

test('offline, a queued write shows at once, and coming back online keeps it until it uploads', () => {
	const { unsynced, state } = queue(false);
	unsynced.read([{ id: 'milk', row: 1 }]);
	expect([...unsynced.shown]).toEqual(['milk']);

	state.online = true;
	unsynced.show();
	expect([...unsynced.shown]).toEqual(['milk']);
	unsynced.read([]);
	expect([...unsynced.shown]).toEqual([]);
});

test('typing that uploads each keystroke before the next lands never outlasts the grace', () => {
	const { unsynced, graces } = queue();
	unsynced.read([{ id: 'notes', row: 1 }]);
	unsynced.read([{ id: 'notes', row: 1 }]);
	unsynced.read([{ id: 'notes', row: 2 }]);
	unsynced.read([{ id: 'notes', row: 3 }]);
	graces[0]!();
	graces[1]!();
	expect([...unsynced.shown]).toEqual([]);

	graces[2]!();
	expect([...unsynced.shown]).toEqual(['notes']);
});
