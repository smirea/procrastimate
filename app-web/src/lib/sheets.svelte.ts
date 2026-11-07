import type { ListDefaults } from 'shared/screens.ts';
import type { ShareTarget } from 'shared/sharing.ts';

export type Arrival = 'forward' | 'back' | 'none';

/** Which floating layer is open. Sheets never stack. */
export type Sheet =
	| { kind: 'none' }
	| { kind: 'quick-add'; defaults: ListDefaults }
	/** The fullscreen voice capture. It opens listening, and saves into the list quick add would have. */
	| { kind: 'ramble'; defaults: ListDefaults }
	| { kind: 'search' }
	| { kind: 'settings' }
	| { kind: 'task'; id: string; arrival: Arrival }
	/** `from` is the task whose details opened it, which closing returns to. */
	| { kind: 'share'; target: ShareTarget; name: string; from: string | null };

class Sheets {
	#current = $state<Sheet>({ kind: 'none' });

	get current() {
		return this.#current;
	}

	/**
	 * A field being edited commits on blur, and iOS Safari never blurs it for a tap on the scrim or a button, so a
	 * sheet change blurs it first: the edit lands before the sheet goes, and an untitled task's new title saves it.
	 */
	set current(next: Sheet) {
		(globalThis.document?.activeElement as HTMLElement | null)?.blur();
		this.#current = next;
	}

	openQuickAdd(defaults: ListDefaults) {
		this.current = { kind: 'quick-add', defaults };
	}

	openRamble(defaults: ListDefaults) {
		this.current = { kind: 'ramble', defaults };
	}

	openSearch() {
		this.current = { kind: 'search' };
	}

	openSettings() {
		this.current = { kind: 'settings' };
	}

	/**
	 * Where each task's details body was scrolled in this sheet. Details remount per task, so going back would
	 * otherwise land at the top of the parent; iOS keeps the place like any navigation pop.
	 */
	readonly scrollTops = new Map<string, number>();

	openTask(id: string, arrival: Arrival = 'none') {
		if (arrival === 'none') this.scrollTops.clear();
		this.current = { kind: 'task', id, arrival };
	}

	openShare(target: ShareTarget, name: string, from: string | null = null) {
		this.current = { kind: 'share', target, name, from };
	}

	close() {
		const current = this.current;
		this.current =
			current.kind === 'share' && current.from ? { kind: 'task', id: current.from, arrival: 'back' } : { kind: 'none' };
	}
}

export const sheets = new Sheets();

/** The task quick add just saved. Its row scrolls into view and flashes, then this clears. */
class Reveal {
	id = $state<string | null>(null);

	show(id: string) {
		this.id = id;
		setTimeout(() => {
			if (this.id === id) this.id = null;
		}, 1500);
	}
}

export const reveal = new Reveal();
