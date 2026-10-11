/** A registered install. `revokedAt` is set once its token is removed; the row stays so the id is never reused. */
export type Device = {
	id: string;
	name: string;
	tokenHash: string;
	createdAt: number;
	lastSeenAt: number;
	revokedAt: number | null;
};

/** The current value of one synced entity, with its per-field clocks. Both are JSON the sync core defines. */
export type Entity = { kind: string; id: string; data: unknown; clocks: unknown };

/** One append-only log row: the fields of one op that won, at server sequence `seq`. */
export type LogEntry = { seq: number; opId: string; kind: string; id: string; fields: unknown };

/**
 * A device's Web Push subscription and what the alarm still owes it. `deliveredThrough` is when the alarm last ran
 * for it, or when it subscribed. Both JSON fields are the push module's.
 */
export type PushTarget = { deviceId: string; subscription: unknown; notifications: unknown; deliveredThrough: number };

/**
 * Everything the `Account` object keeps. Methods are synchronous, like Durable Object SQLite, so a request that
 * finishes its async work (hashing) first can then read and write without another request interleaving.
 */
export interface AccountStore {
	/** Runs `run` atomically where the backing store supports it. */
	transaction<T>(run: () => T): T;

	addDevice(device: Device): void;
	deviceByTokenHash(tokenHash: string): Device | null;
	hasDevice(id: string): boolean;
	/** Devices that are not revoked, oldest first. */
	liveDevices(): Device[];
	touchDevice(id: string, at: number): void;
	/** Returns false when the device is unknown or already revoked. Revoking also drops its push target. */
	revokeDevice(id: string, at: number): boolean;

	entity(kind: string, id: string): Entity | null;
	entities(): Entity[];
	putEntity(entity: Entity): void;

	/** Appends one row and returns its `seq`, which starts at 1. */
	appendLog(entry: Omit<LogEntry, 'seq'>): number;
	/** Rows with `seq` greater than `after`, in order, at most `limit` of them. */
	logAfter(after: number, limit: number): LogEntry[];
	hasOp(opId: string): boolean;
	/** The highest `seq`, or 0 when the log is empty. */
	lastSeq(): number;
	/** Drops every task, project, label, and the log. Devices and push subscriptions stay. */
	clearTaskData(): void;
	/** Bumped when task data is wiped, so a client still holding the old copy drops it. */
	epoch(): number;
	setEpoch(epoch: number): void;

	/** Every device with a push subscription. */
	pushTargets(): PushTarget[];
	/** Adds or replaces the device's target. */
	putPushTarget(target: PushTarget): void;
	deletePushTarget(deviceId: string): void;

	/** Ramble audio seconds streamed on `day`, a date key in the account's time zone. */
	rambleSeconds(day: string): number;
	addRambleSeconds(day: string, seconds: number): void;
}
