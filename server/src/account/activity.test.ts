import { describe, expect, test } from 'bun:test';
import { diff, stamp } from '../../../shared/sync/diff';
import { createClock } from '../../../shared/sync/hlc';
import type { Op, Snapshot, Task } from '../../../shared/sync/protocol';
import { emptySnapshot } from '../../../shared/sync/snapshot';
import { counter, label, project, snapshotOf, task } from '../../../shared/sync/testing';
import { taskActivity } from './activity';
import { memoryStore } from './memory-store';
import type { AccountStore } from './store';
import { sync } from './sync';

const NOW = Date.UTC(2026, 9, 14, 18);
const MINUTE = 60_000;
const ME = 'user-me';
const GUEST = 'user-guest';

const seed = () =>
	snapshotOf({
		tasks: [task('paint', { title: 'Paint the fence' })],
		projects: [project('home', { name: 'Home' })],
		labels: [label('urgent', { name: 'Urgent' })],
	});

/**
 * A device that sends one op per edit, as clients did before the outbox coalesced per field, so the log has the shape
 * production logs still hold. Its first push uploads its whole snapshot.
 */
function device(store: AccountStore, name: string, snapshot = seed()) {
	let clock = createClock(name);
	let current = emptySnapshot();
	let outbox: Op[] = [];
	const record = (next: Snapshot, at: number) => {
		const stamped = stamp(diff(current, next), clock, at, counter(`${name}-${at}-`));
		outbox = [...outbox, ...stamped.ops];
		clock = stamped.clock;
		current = next;
	};
	record(snapshot, NOW);
	return {
		edit(fields: Partial<Task>, at: number) {
			record({ ...current, tasks: current.tasks.map(t => (t.id === 'paint' ? { ...t, ...fields } : t)) }, at);
		},
		outbox: (): Op[] => outbox,
		push(at: number, actor = ME, ops = outbox) {
			const response = sync(store, { cursor: store.lastSeq(), ops, epoch: 0, scope: '' }, at, actor);
			const acked = new Set(response.acked);
			outbox = outbox.filter(op => !acked.has(op.opId));
		},
	};
}

const summaries = (store: AccountStore) =>
	taskActivity(store, 'paint').map(entry => [entry.actor.id, entry.action, entry.summary, entry.at]);

describe('task activity', () => {
	test('the same op pushed again and again is one entry', () => {
		const store = memoryStore();
		const mac = device(store, 'mac');
		mac.push(NOW);
		mac.edit({ notes: 'Blue' }, NOW + 1000);
		const ops = mac.outbox();
		for (let i = 0; i < 5; i++) mac.push(NOW + 2000 + i, ME, ops);
		expect(summaries(store)).toEqual([
			[ME, 'created', 'added this task', NOW],
			[ME, 'edited', 'added notes', NOW + 2000],
		]);
	});

	test('notes typed key by key and sent in one sync are one entry', () => {
		const store = memoryStore();
		const mac = device(store, 'mac');
		mac.push(NOW);
		const text = 'Buy the blue one';
		for (let i = 1; i <= text.length; i++) mac.edit({ notes: text.slice(0, i) }, NOW + 1000 + i * 100);
		mac.push(NOW + 5000);
		expect(summaries(store)).toEqual([
			[ME, 'created', 'added this task', NOW],
			[ME, 'edited', 'added notes', NOW + 5000],
		]);
	});

	test('a second device uploading the same snapshot adds nothing', () => {
		const store = memoryStore();
		device(store, 'mac').push(NOW);
		device(store, 'phone').push(NOW + 1000);
		expect(summaries(store)).toEqual([[ME, 'created', 'added this task', NOW]]);
	});

	test('edits by one actor within five minutes of each other read as one, with each field summarized', () => {
		const store = memoryStore();
		const mac = device(store, 'mac');
		mac.push(NOW);
		mac.edit({ due: { date: '2026-10-20', time: null } }, NOW + MINUTE);
		mac.push(NOW + MINUTE);
		mac.edit({ notes: 'Two coats' }, NOW + 3 * MINUTE);
		mac.push(NOW + 3 * MINUTE);
		mac.edit({ notes: 'Two coats, white' }, NOW + 7 * MINUTE);
		mac.push(NOW + 7 * MINUTE);
		mac.edit({ projectId: 'home', labelIds: ['urgent'], priority: 1 }, NOW + 20 * MINUTE);
		mac.push(NOW + 20 * MINUTE);
		mac.edit({ title: 'Paint the gate', due: { date: '2027-01-02', time: '15:30' } }, NOW + 60 * MINUTE);
		mac.push(NOW + 60 * MINUTE, GUEST);
		expect(summaries(store)).toEqual([
			[ME, 'created', 'added this task', NOW],
			[ME, 'edited', 'set due to Oct 20 and added notes', NOW + 7 * MINUTE],
			[ME, 'edited', 'moved it to Home, added label Urgent and changed priority to P1', NOW + 20 * MINUTE],
			[GUEST, 'edited', 'renamed it to “Paint the gate” and changed due to Jan 2, 2027 at 3:30pm', NOW + 60 * MINUTE],
		]);
	});

	test('another actor’s edit in between keeps the runs apart', () => {
		const store = memoryStore();
		const mac = device(store, 'mac');
		mac.push(NOW);
		mac.edit({ notes: 'a' }, NOW + 1000);
		mac.push(NOW + 1000);
		mac.edit({ priority: 2 }, NOW + 2000);
		mac.push(NOW + 2000, GUEST);
		mac.edit({ notes: 'ab' }, NOW + 3000);
		mac.push(NOW + 3000);
		expect(summaries(store)).toEqual([
			[ME, 'created', 'added this task', NOW],
			[ME, 'edited', 'added notes', NOW + 1000],
			[GUEST, 'edited', 'changed priority to P2', NOW + 2000],
			[ME, 'edited', 'edited notes', NOW + 3000],
		]);
	});

	test('a change undone right away shows nothing', () => {
		const store = memoryStore();
		const mac = device(store, 'mac');
		mac.push(NOW);
		mac.edit({ priority: 1 }, NOW + 1000);
		mac.edit({ priority: 4 }, NOW + 2000);
		mac.edit({ completedAt: NOW + 3000 }, NOW + 3000);
		mac.push(NOW + 3000);
		mac.edit({ completedAt: null }, NOW + 4000);
		mac.push(NOW + 4000);
		expect(summaries(store)).toEqual([[ME, 'created', 'added this task', NOW]]);
	});
});
