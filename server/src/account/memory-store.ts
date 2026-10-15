import type { RambleUsage } from '../../../shared/db/schema';
import type {
	AccountStore,
	ApiTokenRow,
	Device,
	Entity,
	LogRow,
	Membership,
	PersonRow,
	PushTarget,
	ShareRow,
} from './store';

/** The rows a Turso session loads and writes back. `log` is in `seq` order. */
export type AccountTables = {
	devices: Device[];
	entities: Entity[];
	log: LogRow[];
	push: PushTarget[];
	ramble: RambleUsage[];
	shares: ShareRow[];
	memberships: Membership[];
	people: PersonRow[];
	apiTokens: ApiTokenRow[];
	epoch: number;
};

const keyed = <T>(rows: T[] | undefined, key: (row: T) => string) =>
	new Map((rows ?? []).map(row => [key(row), structuredClone(row)]));

/** Ties break by key, as the SQLite store orders them. */
const oldestFirst = <T extends { createdAt: number }>(rows: Map<string, T>) =>
	[...rows]
		.sort(([a, rowA], [b, rowB]) => rowA.createdAt - rowB.createdAt || (a < b ? -1 : a > b ? 1 : 0))
		.map(([, row]) => structuredClone(row));

/**
 * The Bun dev server's account, kept in memory and lost on restart. Values are cloned in and out so callers never
 * share references with the store, like rows read back from SQLite. Transactions do not roll back.
 */
export function memoryStore(seed?: AccountTables): AccountStore & { tables(): AccountTables } {
	const devices = new Map<string, Device>((seed?.devices ?? []).map(device => [device.id, { ...device }]));
	const entities = new Map<string, Entity>();
	const log: LogRow[] = (seed?.log ?? []).map(entry => structuredClone(entry));
	const pushTargets = new Map<string, PushTarget>(
		(seed?.push ?? []).map(target => [target.deviceId, structuredClone(target)]),
	);
	const rambleUsage = new Map<string, number>((seed?.ramble ?? []).map(row => [row.day, row.seconds]));
	const shares = keyed(seed?.shares, share => share.id);
	const memberships = keyed(seed?.memberships, membership => membership.spaceId);
	const people = keyed(seed?.people, person => person.id);
	const apiTokens = keyed(seed?.apiTokens, token => token.id);
	let epoch = seed?.epoch ?? 0;
	let nextSeq = log.at(-1)?.seq ?? 0;
	const entityKey = (kind: string, id: string) => `${kind}\u0000${id}`;
	for (const entity of seed?.entities ?? []) entities.set(entityKey(entity.kind, entity.id), structuredClone(entity));

	const store: AccountStore & { tables(): AccountTables } = {
		transaction: run => run(),

		addDevice: device => {
			devices.set(device.id, { ...device });
		},
		deviceByTokenHash: tokenHash => {
			const device = [...devices.values()].find(device => device.tokenHash === tokenHash);
			return device ? { ...device } : null;
		},
		hasDevice: id => devices.has(id),
		liveDevices: () =>
			[...devices.values()]
				.filter(device => device.revokedAt === null)
				.sort((a, b) => a.createdAt - b.createdAt)
				.map(device => ({ ...device })),
		touchDevice: (id, at) => {
			const device = devices.get(id);
			if (device) device.lastSeenAt = at;
		},
		revokeDevice: (id, at) => {
			const device = devices.get(id);
			if (!device || device.revokedAt !== null) return false;
			device.revokedAt = at;
			pushTargets.delete(id);
			return true;
		},

		entity: (kind, id) => {
			const entity = entities.get(entityKey(kind, id));
			return entity ? structuredClone(entity) : null;
		},
		entities: () => [...entities.values()].map(entity => structuredClone(entity)),
		putEntity: entity => {
			entities.set(entityKey(entity.kind, entity.id), structuredClone(entity));
		},

		appendLog: entry => {
			nextSeq += 1;
			log.push(structuredClone({ ...entry, seq: nextSeq }));
			return nextSeq;
		},
		logAfter: (after, limit) =>
			log
				.filter(entry => entry.seq > after)
				.slice(0, limit)
				.map(entry => structuredClone(entry)),
		hasOp: opId => log.some(entry => entry.opId === opId),
		lastSeq: () => nextSeq,
		clearTaskData: () => {
			entities.clear();
			log.length = 0;
			nextSeq = 0;
		},
		clearAccount: () => {
			devices.clear();
			entities.clear();
			log.length = 0;
			nextSeq = 0;
			pushTargets.clear();
			rambleUsage.clear();
			shares.clear();
			memberships.clear();
			people.clear();
			apiTokens.clear();
			epoch = 0;
		},
		epoch: () => epoch,
		setEpoch: next => {
			epoch = next;
		},

		pushTargets: () => [...pushTargets.values()].map(target => structuredClone(target)),
		putPushTarget: target => {
			pushTargets.set(target.deviceId, structuredClone(target));
		},
		deletePushTarget: deviceId => {
			pushTargets.delete(deviceId);
		},

		rambleSeconds: day => rambleUsage.get(day) ?? 0,
		addRambleSeconds: (day, seconds) => {
			rambleUsage.set(day, (rambleUsage.get(day) ?? 0) + seconds);
		},

		shares: () => oldestFirst(shares),
		putShare: share => {
			shares.set(share.id, structuredClone(share));
		},
		deleteShare: id => {
			shares.delete(id);
		},

		memberships: () => oldestFirst(memberships),
		putMembership: membership => {
			memberships.set(membership.spaceId, structuredClone(membership));
		},
		deleteMembership: spaceId => {
			memberships.delete(spaceId);
		},

		people: () => [...people.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(person => structuredClone(person)),
		upsertPerson: person => {
			people.set(person.id, structuredClone(person));
		},

		apiTokens: () => oldestFirst(apiTokens),
		putApiToken: token => {
			apiTokens.set(token.id, structuredClone(token));
		},
		deleteApiToken: id => {
			apiTokens.delete(id);
		},
		apiTokenByHash: tokenHash => {
			const token = [...apiTokens.values()].find(token => token.tokenHash === tokenHash);
			return token ? structuredClone(token) : null;
		},
		touchApiToken: (id, at) => {
			const token = apiTokens.get(id);
			if (token) token.lastUsedAt = at;
		},

		tables: () => ({
			devices: [...devices.values()].map(device => ({ ...device })),
			entities: [...entities.values()].map(entity => structuredClone(entity)),
			log: log.map(entry => structuredClone(entry)),
			push: [...pushTargets.values()].map(target => structuredClone(target)),
			ramble: [...rambleUsage].map(([day, seconds]) => ({ day, seconds })),
			shares: [...shares.values()].map(share => structuredClone(share)),
			memberships: [...memberships.values()].map(membership => structuredClone(membership)),
			people: [...people.values()].map(person => structuredClone(person)),
			apiTokens: [...apiTokens.values()].map(token => structuredClone(token)),
			epoch,
		}),
	};
	return store;
}
