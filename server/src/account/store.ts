import type { Kind } from '../../../shared/sync/kinds';
import type {
	ApiTokenRow,
	Device,
	LogRow,
	Membership,
	PersonRow,
	PushTarget,
	ShareRow,
	TaskClientsRow,
} from '../../../shared/db/schema';
import type { ServerEntity as Entity } from '../../../shared/sync/merge';
import { span } from '../sentry';

export type { ApiTokenRow, Device, Entity, LogRow, Membership, PersonRow, PushTarget, ShareRow, TaskClientsRow };

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
	taskClients(id: string): TaskClientsRow | null;
	/** Inserts or replaces by id. */
	putTaskClients(row: TaskClientsRow): void;
	/** Drops every task, project, label, and the log. Devices, push subscriptions, and task clients stay. */
	clearTaskData(): void;
	/** Drops the whole account: tasks, task clients, devices, push, Ramble usage, shares, memberships, people, and API tokens. */
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

	/** Shares this space grants, oldest first. */
	shares(): ShareRow[];
	/** Inserts or replaces by id. */
	putShare(share: ShareRow): void;
	deleteShare(id: string): void;

	/** Spaces shared with this user, oldest first. */
	memberships(): Membership[];
	putMembership(membership: Membership): void;
	deleteMembership(spaceId: string): void;

	people(): PersonRow[];
	/** Inserts or replaces by id. */
	upsertPerson(person: PersonRow): void;

	/** API tokens of this user's AI accounts, oldest first. */
	apiTokens(): ApiTokenRow[];
	putApiToken(token: ApiTokenRow): void;
	deleteApiToken(id: string): void;
	apiTokenByHash(tokenHash: string): ApiTokenRow | null;
	touchApiToken(id: string, at: number): void;
}

/** Called once per op or entity, so a span each would cost a big sync more CPU than its own work. */
const PER_ITEM: ReadonlySet<keyof AccountStore> = new Set([
	'entity',
	'putEntity',
	'appendLog',
	'hasOp',
	'hasDevice',
	'taskClients',
	'putTaskClients',
]);

/** `store` with a `db` span around every call except the per-item ones. */
export function tracedStore(store: AccountStore): AccountStore {
	return new Proxy(store, {
		get(target, key, receiver) {
			const value = Reflect.get(target, key, receiver);
			if (typeof value !== 'function' || PER_ITEM.has(key as keyof AccountStore)) return value;
			return (...args: unknown[]) => span(`AccountStore.${String(key)}`, 'db', () => value.apply(target, args));
		},
	});
}
