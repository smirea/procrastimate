import type { RambleTask } from 'shared/ramble.ts';
import type { RambleOutline } from 'shared/ramble/outline.ts';

export type OutlineRequest = (transcript: string, signal: AbortSignal) => Promise<RambleOutline>;
export type Outlined = { transcript: string; outline: RambleOutline };

/**
 * Keeps Gemini's outline of a ramble current while it is spoken, so stopping rarely waits on a request. One request
 * is in flight at a time, sent once the words settle for `settleMs`; the newest transcript goes next. A failed
 * request turns the outliner off for the session, and the grammar's tasks stand.
 */
export class Outliner {
	latest: Outlined | null = null;
	#pending: string | null = null;
	#inflight: { transcript: string; controller: AbortController; done: Promise<Outlined | null> } | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#off = false;

	constructor(
		private readonly request: OutlineRequest,
		private readonly onOutline: (outlined: Outlined) => void,
		private readonly settleMs = 500,
	) {}

	get off(): boolean {
		return this.#off;
	}

	update(transcript: string) {
		if (this.#off || !transcript.trim() || transcript === this.latest?.transcript) return;
		this.#pending = transcript;
		clearTimeout(this.#timer);
		if (!this.#inflight) this.#timer = setTimeout(() => this.#send(), this.settleMs);
	}

	/** The outline of exactly `transcript`, or null when there is none within `timeoutMs`. */
	async settle(transcript: string, timeoutMs: number): Promise<RambleOutline | null> {
		clearTimeout(this.#timer);
		if (this.latest?.transcript === transcript) return this.latest.outline;
		if (this.#off || !transcript.trim()) return null;
		if (this.#inflight?.transcript !== transcript) {
			this.#inflight?.controller.abort();
			this.#inflight = null;
			this.#pending = transcript;
			this.#send();
		}
		const done = this.#inflight!.done;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<null>(resolve => (timer = setTimeout(() => resolve(null), timeoutMs)));
		const outlined = await Promise.race([done, timeout]);
		clearTimeout(timer);
		return outlined?.transcript === transcript ? outlined.outline : null;
	}

	stop() {
		clearTimeout(this.#timer);
		this.#inflight?.controller.abort();
		this.#inflight = null;
		this.#off = true;
	}

	#send() {
		const transcript = this.#pending;
		this.#pending = null;
		if (transcript === null) return;
		const controller = new AbortController();
		const done = this.request(transcript, controller.signal).then(
			outline => {
				if (controller.signal.aborted) return null;
				this.latest = { transcript, outline };
				this.onOutline(this.latest);
				return this.latest;
			},
			() => {
				if (!controller.signal.aborted) this.#off = true;
				return null;
			},
		);
		const inflight = { transcript, controller, done };
		this.#inflight = inflight;
		void done.then(() => {
			if (this.#inflight !== inflight) return;
			this.#inflight = null;
			if (this.#pending !== null && !this.#off) this.#send();
		});
	}
}

/**
 * The live list in smart mode: the outline's tasks, then the grammar's for the words spoken since it was asked. When
 * the recognizer revised earlier words, the outline alone stands until the next one.
 */
export function smartTasks(
	transcript: string,
	latest: Outlined | null,
	parse: (text: string) => RambleTask[],
	resolve: (outline: RambleOutline) => RambleTask[],
): RambleTask[] {
	if (!latest) return parse(transcript);
	const tail = transcript.startsWith(latest.transcript) ? transcript.slice(latest.transcript.length) : '';
	return [...resolve(latest.outline), ...(tail.trim() ? parse(tail) : [])];
}
