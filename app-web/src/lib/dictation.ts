import { voiceCapture, type DictationChoice, type VoiceCapture } from 'shared/dictation.ts';
import { parseRamble, type RambleDraft, type RambleOptions } from 'shared/ramble.ts';

/** Why a native session stopped. `unsupported` means the browser has no SpeechRecognition. */
export type DictationEnd = 'stopped' | 'unsupported' | 'denied' | 'error';

export type SpeechPiece = { transcript: string; isFinal: boolean };

/** The recognizer surface `startVoiceInput` drives. The browser's SpeechRecognition satisfies it. */
export type SpeechSession = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult: ((event: { results: ArrayLike<SpeechPiece> }) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
};

const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported']);

/** `SpeechRecognition` where the browser has it, including the webkit-prefixed one in Safari. */
export function speechRecognitionConstructor(): (new () => SpeechSession) | null {
	if (typeof window === 'undefined') return null;
	const host = window as Window & {
		SpeechRecognition?: new () => SpeechSession;
		webkitSpeechRecognition?: new () => SpeechSession;
	};
	return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

export function dictationText(
	committed: string,
	results: ArrayLike<SpeechPiece>,
): { text: string; finals: string; settled: boolean } {
	let finals = '';
	let interim = '';
	for (let i = 0; i < results.length; i++) {
		const piece = results[i];
		if (!piece) continue;
		if (piece.isFinal) finals += piece.transcript;
		else interim += piece.transcript;
	}
	return {
		text: `${committed}${finals}${interim}`.replace(/\s+/g, ' ').trim(),
		finals,
		settled: interim === '',
	};
}

/**
 * Platform speech for one session. A browser without the API, or a session that errors, does not open
 * ElevenLabs. The text gathered so far stays with the caller, which runs it through the Ramble grammar.
 */
export class NativeDictation {
	#session: SpeechSession | null = null;
	#committed = '';
	#finals = '';
	#stopped = false;
	#fatal: DictationEnd | null = null;
	#fastEnds = 0;
	#startedAt = 0;
	#create: () => SpeechSession | null = () => null;

	constructor(
		private readonly onTranscript: (text: string, settled: boolean) => void,
		private readonly onEnd: (reason: DictationEnd) => void,
	) {}

	start(create: () => SpeechSession | null) {
		this.#create = create;
		this.#stopped = false;
		this.#fatal = null;
		if (!this.#open()) this.onEnd('unsupported');
	}

	stop() {
		this.#stopped = true;
		const session = this.#session;
		if (!session) this.onEnd('stopped');
		else session.stop();
	}

	#open(): boolean {
		const session = this.#create();
		if (!session) return false;
		session.lang = 'en-US';
		session.continuous = true;
		session.interimResults = true;
		session.onresult = event => {
			this.#fastEnds = 0;
			const next = dictationText(this.#committed, event.results);
			this.#finals = next.finals;
			this.onTranscript(next.text, next.settled);
		};
		session.onerror = event => {
			if (!FATAL.has(event.error)) return;
			this.#fatal = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'denied' : 'error';
		};
		session.onend = () => {
			this.#committed = `${this.#committed}${this.#finals}`.replace(/\s+/g, ' ').trim();
			this.#finals = '';
			this.#session = null;
			if (this.#stopped) return this.onEnd('stopped');
			if (this.#fatal) return this.onEnd(this.#fatal);
			const fast = Date.now() - this.#startedAt < 250;
			this.#fastEnds = fast ? this.#fastEnds + 1 : 0;
			if (this.#fastEnds >= 3) return this.onEnd('error');
			if (!this.#open()) this.onEnd('unsupported');
		};
		this.#session = session;
		this.#startedAt = Date.now();
		session.start();
		return true;
	}
}

export type VoiceInput = { plan: VoiceCapture; stop: () => void };

/**
 * Starts the voice path Ramble and any other speech input use. Each transcript is parsed by the Ramble grammar.
 * `socket` is the ElevenLabs path, left for the Ramble client to open. `typed` means the platform has no
 * recognizer the page can start, so the transcript field stays the input.
 */
export function startVoiceInput(options: {
	choice: DictationChoice;
	online: boolean;
	/** Defaults to whether this browser has SpeechRecognition. */
	nativeSpeech?: boolean;
	createRecognition?: () => SpeechSession | null;
	ramble: RambleOptions;
	onDraft: (draft: RambleDraft, text: string) => void;
	onEnd?: (reason: DictationEnd) => void;
}): VoiceInput {
	const nativeSpeech = options.nativeSpeech ?? speechRecognitionConstructor() !== null;
	const plan = voiceCapture(options.choice, options.online, nativeSpeech);
	if (plan.capture !== 'speech') return { plan, stop() {} };
	const dictation = new NativeDictation(
		text => options.onDraft(parseRamble(text, options.ramble), text),
		reason => options.onEnd?.(reason),
	);
	dictation.start(
		options.createRecognition ??
			(() => {
				const Ctor = speechRecognitionConstructor();
				return Ctor ? new Ctor() : null;
			}),
	);
	return { plan, stop: () => dictation.stop() };
}
