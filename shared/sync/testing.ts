import { applyResponse, commit, startSync, type ClientSync } from './apply.ts';
import { applyPush, createServerState, serverHlc, serverSnapshot, type ServerState } from './merge.ts';
import type { Change, Snapshot, SyncResponse } from './protocol.ts';
import { emptySnapshot } from './snapshot.ts';
import type { Label, Project, Task } from '../task.ts';

/** Test doubles: an in-memory server that keeps a log the way the `Account` object does, and a client. */

export const task = (id: string, fields: Partial<Task> = {}): Task => ({
	id,
	parentId: null,
	order: 0,
	title: id,
	notes: '',
	projectId: null,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	createdAt: 1,
	completedAt: null,
	...fields,
});

export const project = (id: string, fields: Partial<Project> = {}): Project => ({
	id,
	name: id,
	createdAt: 1,
	...fields,
});

export const label = (id: string, fields: Partial<Label> = {}): Label => ({ id, name: id, createdAt: 1, ...fields });

export const snapshotOf = (fields: Partial<Snapshot> = {}): Snapshot => ({ ...emptySnapshot(), ...fields });

export const counter = (prefix: string) => {
	let n = 0;
	return () => `${prefix}${++n}`;
};

export class MemoryServer {
	state: ServerState = createServerState();
	log: Change[] = [];
	private readonly nextOpId = counter('server-op-');

	sync(cursor: number, ops: ClientSync['outbox'], now: number): SyncResponse {
		const pushed = applyPush(this.state, ops, {
			now,
			isApplied: id => this.log.some(change => change.opId === id),
			nextOpId: this.nextOpId,
		});
		this.state = pushed.state;
		for (const entry of pushed.log) this.log.push({ ...entry, seq: this.log.length + 1 });
		const base = { acked: pushed.acked, cursor: this.log.length, hlc: serverHlc(this.state) };
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
		/** How far this device's clock runs ahead of the true time. */
		readonly skew = 0,
	) {
		this.snapshot = snapshot;
		this.nextOpId = counter(`${name}-op-`);
		this.sync = startSync(snapshot, name, skew, this.nextOpId);
	}

	run(command: (snapshot: Snapshot) => Snapshot, now: number) {
		const after = command(this.snapshot);
		this.sync = commit(this.sync, this.snapshot, after, now + this.skew, this.nextOpId);
		this.snapshot = after;
	}

	/** Pushes the outbox and applies the answer, unless the answer is lost on the way back. */
	pull(server: MemoryServer, now: number, { lost = false } = {}) {
		const response = server.sync(this.sync.cursor, this.sync.outbox, now);
		if (lost) return;
		({ snapshot: this.snapshot, sync: this.sync } = applyResponse(this.snapshot, this.sync, response));
	}
}
