/** A paired device. `revokedAt` is set once its token is removed; the row stays so the id is never reused. */
export type Device = {
	id: string;
	name: string;
	tokenHash: string;
	createdAt: number;
	lastSeenAt: number;
	revokedAt: number | null;
};

/** The one live pairing code, stored as a hash. A new code replaces it. */
export type Pairing = { codeHash: string; expiresAt: number; attempts: number };

/** The current value of one synced entity, with its per-field clocks. Both are JSON the sync core defines. */
export type Entity = { kind: string; id: string; data: unknown; clocks: unknown };

/** One append-only log row: the fields of one op that won, at server sequence `seq`. */
export type LogEntry = { seq: number; opId: string; kind: string; id: string; fields: unknown };

/**
 * Everything the `Account` object keeps. Methods are synchronous, like Durable Object SQLite, so a request that
 * finishes its async work (hashing) first can then read and write without another request interleaving.
 */
export interface AccountStore {
	/** Runs `run` atomically where the backing store supports it. */
	transaction<T>(run: () => T): T;

	addDevice(device: Device): void;
	deviceByTokenHash(tokenHash: string): Device | null;
	/** Devices that are not revoked, oldest first. */
	liveDevices(): Device[];
	touchDevice(id: string, at: number): void;
	/** Returns false when the device is unknown or already revoked. */
	revokeDevice(id: string, at: number): boolean;

	pairing(): Pairing | null;
	setPairing(pairing: Pairing | null): void;

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
}
