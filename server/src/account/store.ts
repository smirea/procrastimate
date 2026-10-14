import type { Kind } from '../../../shared/sync/kinds';
import type { Device, LogRow, PushTarget } from '../../../shared/db/schema';
import type { ServerEntity as Entity } from '../../../shared/sync/merge';

export type { Device, Entity, LogRow, PushTarget };

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

	entity(kind: Kind, id: string): Entity | null;
	entities(): Entity[];
	putEntity(entity: Entity): void;

	/** Appends one row and returns its `seq`, which starts at 1. */
	appendLog(entry: Omit<LogRow, 'seq'>): number;
	logAfter(after: number, limit: number): LogRow[];
	hasOp(opId: string): boolean;
	/** The highest `seq`, or 0 when the log is empty. */
	lastSeq(): number;
	/** Drops every task, project, label, and the log. Devices and push subscriptions stay. */
	clearTaskData(): void;
	/** Drops the whole account: tasks, devices, push, and Ramble usage. */
	clearAccount(): void;
	/** Bumped when task data is wiped, so a client still holding the old copy drops it. */
	epoch(): number;
	setEpoch(epoch: number): void;

	pushTargets(): PushTarget[];
	putPushTarget(target: PushTarget): void;
	deletePushTarget(deviceId: string): void;

	/** Ramble audio seconds streamed on `day`, a date key in the account's time zone. */
	rambleSeconds(day: string): number;
	addRambleSeconds(day: string, seconds: number): void;
}
