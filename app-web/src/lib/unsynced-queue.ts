type Queued = { row: number; ripe: boolean };

/**
 * Which queued tasks show as unsynced. Online, a task shows only once its oldest queued write has waited out the grace
 * that `wait` times; offline it shows at once. The grace runs from a task's oldest queued write, so typing that uploads
 * keystroke by keystroke, each one queued before the last lands, never shows it.
 */
export class UnsyncedQueue {
	#queued = new Map<string, Queued>();

	constructor(
		readonly shown: Set<string>,
		private readonly wait: (ripen: () => void) => void,
		private readonly online: () => boolean,
	) {}

	/** Takes each queued task with the id of its oldest queued write. */
	read(rows: { id: string; row: number }[]) {
		const queued = new Map<string, Queued>();
		const waiting: Queued[] = [];
		for (const { id, row } of rows) {
			const known = this.#queued.get(id);
			if (known?.row === row) {
				queued.set(id, known);
				continue;
			}
			const entry = { row, ripe: false };
			queued.set(id, entry);
			waiting.push(entry);
			this.shown.delete(id);
		}
		this.#queued = queued;
		if (waiting.length)
			this.wait(() => {
				for (const entry of waiting) entry.ripe = true;
				this.show();
			});
		this.show();
	}

	/** A shown task stays until its oldest write leaves the queue, so coming back online never hides it for a moment. */
	show() {
		for (const id of this.shown) if (!this.#queued.has(id)) this.shown.delete(id);
		for (const [id, { ripe }] of this.#queued) if (ripe || !this.online()) this.shown.add(id);
	}

	clear() {
		this.#queued.clear();
		this.shown.clear();
	}
}
