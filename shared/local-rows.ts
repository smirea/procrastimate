import type { z } from 'zod';
import { resolveDangling } from './dangling.ts';
import { KINDS, SETTINGS_ID, type accessSchema, type Kind, type Settings, type Snapshot } from './model.ts';
import { byId, emptySnapshot, entityFrom, sortSnapshot, withEntities, type Entity, type Fields } from './snapshot.ts';
import type { StoreData } from './store.ts';

/**
 * A client's local database as last read, grouped into spaces by `user_id`: the signed-in user's rows are their own data,
 * and each other owner is a space shared with them. Both clients keep one and apply every read of the change log to it,
 * so each read touches only the rows it names and only the spaces those rows live in are built again. It holds the
 * stored rows rather than what a store shows: a reference to a row that is gone reads as empty (`resolveDangling`) only
 * until the row comes back. A row that does not parse is left out, and read markers and settings are only ever the
 * user's own.
 */

export type Access = z.infer<typeof accessSchema>;
export type StoredRow = { userId: string; id: string } & Fields;

/** One table's part of a read: the ids it covered, or `all` for the whole table, and the rows that still have them. */
export type TableRead<R> = { ids: readonly string[] | 'all'; rows: readonly R[] };
export type RowsRead = { [K in Kind]?: TableRead<StoredRow> } & { access?: TableRead<Access> };

/** What the user sees of one shared space: its data and the `access` rows that reach it, by id. */
export type SpaceRows = { data: StoreData; access: Access[] };

type OwnerRows = Record<Kind, Map<string, Entity>> & { access: Map<string, Access> };

const ownerRows = (): OwnerRows => ({
	...(Object.fromEntries(KINDS.map(kind => [kind, new Map()])) as Record<Kind, Map<string, Entity>>),
	access: new Map(),
});

export class LocalRows {
	#owners = new Map<string, OwnerRows>();
	#ownerOf = new Map<string, string>();

	constructor(readonly me: string) {}

	/** Applies a read and returns the owners whose rows it changed, sorted. */
	apply(read: RowsRead): string[] {
		const touched = new Set<string>();
		for (const kind of [...KINDS, 'access'] as const) {
			const table = read[kind];
			if (!table) continue;
			const key = (id: string) => `${kind}:${id}`;
			const drop = (id: string) => {
				const owner = this.#ownerOf.get(key(id));
				if (owner === undefined) return;
				this.#ownerOf.delete(key(id));
				this.#owners.get(owner)![kind].delete(id);
				touched.add(owner);
			};
			if (table.ids === 'all') for (const rows of this.#owners.values()) for (const id of rows[kind].keys()) drop(id);
			else for (const id of table.ids) drop(id);
			for (const row of table.rows) {
				const owner = kind === 'access' ? (row as Access).owner : (row as StoredRow).userId;
				if (owner !== this.me && (kind === 'read' || kind === 'settings')) continue;
				const entity = kind === 'access' ? row : entityFrom(kind, row.id, row as StoredRow);
				if (!entity) continue;
				const rows = this.#owners.get(owner) ?? this.#owners.set(owner, ownerRows()).get(owner)!;
				(rows[kind] as Map<string, unknown>).set(row.id, entity);
				this.#ownerOf.set(key(row.id), owner);
				touched.add(owner);
			}
		}
		for (const owner of touched) {
			const rows = this.#owners.get(owner)!;
			if (Object.values(rows).every(map => map.size === 0)) this.#owners.delete(owner);
		}
		return [...touched].sort();
	}

	#snapshot(owner: string): Snapshot {
		const rows = this.#owners.get(owner);
		let snapshot = emptySnapshot();
		if (!rows) return snapshot;
		for (const kind of KINDS) {
			if (kind !== 'settings' || rows.settings.has(SETTINGS_ID))
				snapshot = withEntities(snapshot, kind, [...rows[kind].values()]);
		}
		return sortSnapshot(resolveDangling(snapshot));
	}

	own(): StoreData {
		const { settings: _, ...own } = this.#snapshot(this.me);
		return own;
	}

	/** Null until the server's settings row has synced. */
	settings(): Settings | null {
		const row = this.#owners.get(this.me)?.settings.get(SETTINGS_ID);
		if (!row) return null;
		const { id: _, ...settings } = row;
		return settings as Settings;
	}

	/** Every owner other than the user with something that reaches them, sorted. */
	sharers(): string[] {
		return [...this.#owners.keys()].filter(owner => owner !== this.me).sort();
	}

	/** Null once nothing of the owner's reaches this user. */
	space(owner: string): SpaceRows | null {
		if (owner === this.me || !this.#owners.has(owner)) return null;
		const { settings: _, ...data } = this.#snapshot(owner);
		return { data: { ...data, reads: [] }, access: [...this.#owners.get(owner)!.access.values()].sort(byId) };
	}
}
