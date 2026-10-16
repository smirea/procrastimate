import { applyResponse, commit, startSync, type ClientSync } from './apply.ts';
import { diff, stamp } from './diff.ts';
import { createClock } from './hlc.ts';
import { applyPush, createServerState, serverHlc, serverSnapshot, type ServerState } from './merge.ts';
import type { Change, Snapshot, SyncResponse } from './protocol.ts';
import { emptySnapshot } from './snapshot.ts';
import type { Label, Project, Section, Task } from '../task.ts';

export const task = (id: string, fields: Partial<Task> = {}): Task => ({
	id,
	parentId: null,
	order: 0,
	title: id,
	notes: '',
	projectId: null,
	sectionId: null,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	location: null,
	event: null,
	images: [],
	createdAt: 1,
	completedAt: null,
	createdBy: null,
	completedBy: null,
	lastCompletedAt: null,
	...fields,
});

export const project = (id: string, fields: Partial<Project> = {}): Project => ({
	id,
	name: id,
	order: 0,
	createdAt: 1,
	...fields,
});

export const section = (id: string, projectId: string, fields: Partial<Section> = {}): Section => ({
	id,
	projectId,
	name: id,
	order: 0,
	createdAt: 1,
	...fields,
});

export const label = (id: string, fields: Partial<Label> = {}): Label => ({
	id,
	name: id,
	color: 'gray',
	createdAt: 1,
	...fields,
});

export const snapshotOf = (
	fields: Partial<Omit<Snapshot, 'settings'>> & { settings?: Partial<Snapshot['settings']> } = {},
): Snapshot => ({
	...emptySnapshot(),
	...fields,
	settings: { ...emptySnapshot().settings, ...fields.settings },
});

export const counter = (prefix: string) => {
	let n = 0;
	return () => `${prefix}${++n}`;
};

/** Every entity of a snapshot as create ops, the way a device that already had them would have queued them. */
export const createOps = (snapshot: Snapshot, node: string, now: number, nextOpId: () => string) =>
	stamp(diff(emptySnapshot(), snapshot), createClock(node), now, nextOpId).ops;

export class MemoryServer {
	state: ServerState = createServerState();
	log: Change[] = [];
	epoch = 0;
	private readonly nextOpId = counter('server-op-');

	sync(cursor: number, ops: ClientSync['outbox'], now: number): SyncResponse {
		const pushed = applyPush(this.state, ops, {
			now,
			isApplied: id => this.log.some(change => change.opId === id),
			nextOpId: this.nextOpId,
		});
		this.state = pushed.state;
		for (const entry of pushed.log) this.log.push({ ...entry, seq: this.log.length + 1 });
		const base = {
			acked: pushed.acked,
			rejected: [],
			cursor: this.log.length,
			hlc: serverHlc(this.state),
			epoch: this.epoch,
		};
		if (cursor === 0) return { ...base, snapshot: serverSnapshot(this.state) };
		return { ...base, changes: this.log.filter(change => change.seq > cursor) };
	}

	get snapshot() {
		return serverSnapshot(this.state);
	}
}

export class MemoryClient {
	snapshot: Snapshot;
	sync: ClientSync;
	private readonly nextOpId: () => string;

	constructor(
		readonly name: string,
		snapshot: Snapshot = emptySnapshot(),
		readonly skew = 0,
	) {
		this.snapshot = snapshot;
		this.nextOpId = counter(`${name}-op-`);
		this.sync = startSync(snapshot.settings, name, skew, this.nextOpId);
	}

	run(command: (snapshot: Snapshot) => Snapshot, now: number) {
		const after = command(this.snapshot);
		this.sync = commit(this.sync, this.snapshot, after, now + this.skew, this.nextOpId);
		this.snapshot = after;
	}

	/**
	 * Pushes the outbox and applies the answer, unless the answer is lost on the way back. Like the apps, it goes
	 * again when the first snapshot seeded the outbox.
	 */
	pull(server: MemoryServer, now: number, { lost = false } = {}) {
		const response = server.sync(this.sync.cursor, this.sync.outbox, now);
		if (lost) return;
		const seeding = this.sync.seed;
		({ snapshot: this.snapshot, sync: this.sync } = applyResponse(this.snapshot, this.sync, response, now + this.skew, {
			nextOpId: this.nextOpId,
		}));
		if (seeding && !this.sync.seed && this.sync.outbox.length) this.pull(server, now);
	}
}
