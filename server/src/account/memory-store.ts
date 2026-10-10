import type { AccountStore, Device, Entity, LogEntry, Pairing } from './store';

/**
 * The Bun dev server's account, kept in memory and lost on restart. Values are cloned in and out so callers never
 * share references with the store, like rows read back from SQLite. Transactions do not roll back.
 */
export function memoryStore(): AccountStore {
	const devices = new Map<string, Device>();
	const entities = new Map<string, Entity>();
	const log: LogEntry[] = [];
	let pairing: Pairing | null = null;
	const entityKey = (kind: string, id: string) => `${kind}\u0000${id}`;

	return {
		transaction: run => run(),

		addDevice: device => {
			devices.set(device.id, { ...device });
		},
		deviceByTokenHash: tokenHash => {
			const device = [...devices.values()].find(device => device.tokenHash === tokenHash);
			return device ? { ...device } : null;
		},
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
			return true;
		},

		pairing: () => (pairing ? { ...pairing } : null),
		setPairing: next => {
			pairing = next ? { ...next } : null;
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
			const seq = log.length + 1;
			log.push(structuredClone({ ...entry, seq }));
			return seq;
		},
		logAfter: (after, limit) => log.slice(after, after + limit).map(entry => structuredClone(entry)),
		hasOp: opId => log.some(entry => entry.opId === opId),
		lastSeq: () => log.length,
	};
}
