import { describe, expect, test } from 'bun:test';
import { parseSnapshot } from 'shared/snapshot.ts';
import { task } from 'shared/sync/testing.ts';
import { dropInvalidOps } from './persistence.ts';

const good = { opId: 'good', hlc: '20:0:a', kind: 'task', id: 't', fields: { notes: 'n' } };
const bad = { opId: 'bad', hlc: '21:0:a', kind: 'task', id: 't', fields: { due: { date: '12784-10-19', time: null } } };
const stored = (outbox: unknown[]) => ({
	tasks: [task('t')],
	projects: [],
	remindersCheckedAt: 1,
	sync: { deviceId: 'a', cursor: 7, outbox, clock: '21:0:a', timeZone: 'UTC' },
});

describe('dropInvalidOps', () => {
	test('drops a stored op that no longer validates, keeps the rest of the document, and asks for a snapshot', () => {
		const loaded = parseSnapshot(dropInvalidOps(stored([good, bad])), 1);
		expect(loaded.tasks.map(t => t.id)).toEqual(['t']);
		expect(loaded.sync).toMatchObject({ cursor: 0, outbox: [good] });
	});

	test('leaves a valid outbox and its cursor alone', () => {
		expect(parseSnapshot(dropInvalidOps(stored([good])), 1).sync).toMatchObject({ cursor: 7, outbox: [good] });
	});
});
