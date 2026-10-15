import { toasts } from './ui.svelte.ts';

/**
 * A row of a server-backed list. `key` stays the same from the optimistic placeholder to the server's copy, so the
 * row never re-mounts. `saved` settles with the server's copy, or null when the server refused it.
 */
export type Row<T> = { key: string; value: T; pending: boolean; saved: Promise<T | null> };

/**
 * A list the server owns but the user changes instantly: an add shows its placeholder at once, a remove hides the row
 * at once, and a refusal puts things back and says so in a toast. Acting on a row that is still being created waits
 * for it.
 */
export class OptimisticList<T> {
	rows = $state.raw<Row<T>[]>([]);

	constructor(private readonly keyOf: (value: T) => string) {}

	/** Keeps rows still being created, so an add made before the list arrived survives it. */
	load(values: readonly T[]) {
		const loaded = values.map(value => ({
			key: this.keyOf(value),
			value,
			pending: false,
			saved: Promise.resolve(value),
		}));
		this.rows = [...loaded, ...this.rows.filter(row => row.pending)];
	}

	add(placeholder: T, request: () => Promise<T>, failure: string): Row<T> {
		const key = `pending-${crypto.randomUUID()}`;
		const saved = request().then(
			value => {
				this.rows = this.rows.map(row => (row.key === key ? { ...row, value, pending: false } : row));
				return value;
			},
			() => {
				if (this.rows.some(row => row.key === key)) toasts.show(failure);
				this.rows = this.rows.filter(row => row.key !== key);
				return null;
			},
		);
		const row = { key, value: placeholder, pending: true, saved };
		this.rows = [...this.rows, row];
		return row;
	}

	async remove(row: Row<T>, request: (value: T) => Promise<unknown>, failure: string) {
		const index = this.rows.findIndex(r => r.key === row.key);
		if (index === -1) return;
		this.rows = this.rows.toSpliced(index, 1);
		const value = await row.saved;
		if (value === null) return;
		try {
			await request(value);
		} catch {
			this.rows = this.rows.toSpliced(Math.min(index, this.rows.length), 0, { ...row, value, pending: false });
			toasts.show(failure);
		}
	}
}
