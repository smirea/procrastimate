import { describe, expect, test } from 'bun:test';
import { dictationText, startVoiceInput, type SpeechPiece, type SpeechSession } from './dictation.ts';

const now = new Date('2026-10-14T10:00:00Z');

class FakeRecognition implements SpeechSession {
	lang = '';
	continuous = false;
	interimResults = false;
	onresult: ((event: { results: ArrayLike<SpeechPiece> }) => void) | null = null;
	onerror: ((event: { error: string }) => void) | null = null;
	onend: (() => void) | null = null;
	started = 0;
	stopped = 0;

	start() {
		this.started += 1;
	}

	stop() {
		this.stopped += 1;
		this.onend?.();
	}

	abort() {
		this.onend?.();
	}

	say(pieces: SpeechPiece[]) {
		this.onresult?.({ results: pieces });
	}

	fail(error: string) {
		this.onerror?.({ error });
		this.onend?.();
	}
}

describe('dictationText', () => {
	test('keeps committed text and prefers a final piece over the interim one', () => {
		const next = dictationText('Buy milk. ', [
			{ transcript: 'Call mom', isFinal: true },
			{ transcript: ' tomorrow', isFinal: false },
		]);
		expect(next.text).toBe('Buy milk. Call mom tomorrow');
		expect(next.finals).toBe('Call mom');
		expect(next.settled).toBe(false);
	});
});

describe('startVoiceInput', () => {
	test('native speech runs the ramble grammar on the transcript', () => {
		const recognition = new FakeRecognition();
		const drafts: string[] = [];
		const input = startVoiceInput({
			choice: 'native',
			online: true,
			nativeSpeech: true,
			createRecognition: () => recognition,
			ramble: { now },
			onDraft: draft => drafts.push(draft.tasks.map(task => task.title).join('|')),
		});
		expect(input.plan).toEqual({ engine: 'native', capture: 'speech' });
		expect(recognition.lang).toBe('en-US');
		expect(recognition.continuous).toBe(true);
		recognition.say([{ transcript: 'Buy milk', isFinal: true }]);
		expect(drafts).toEqual(['Buy milk']);
		input.stop();
		expect(recognition.stopped).toBe(1);
	});

	test('elevenlabs is the socket only while online, and does not start the recognizer', () => {
		let created = 0;
		const online = startVoiceInput({
			choice: 'elevenlabs',
			online: true,
			nativeSpeech: true,
			createRecognition: () => {
				created += 1;
				return new FakeRecognition();
			},
			ramble: { now },
			onDraft: () => {},
		});
		expect(online.plan).toEqual({ engine: 'elevenlabs', capture: 'socket' });
		expect(created).toBe(0);

		const recognition = new FakeRecognition();
		const offline = startVoiceInput({
			choice: 'elevenlabs',
			online: false,
			nativeSpeech: true,
			createRecognition: () => recognition,
			ramble: { now },
			onDraft: () => {},
		});
		expect(offline.plan).toEqual({ engine: 'native', capture: 'speech' });
		expect(recognition.started).toBe(1);
	});

	test('a browser without SpeechRecognition types, and does not open ElevenLabs', () => {
		const input = startVoiceInput({
			choice: 'native',
			online: true,
			nativeSpeech: false,
			ramble: { now },
			onDraft: () => {
				throw new Error('typed dictation does not start a session');
			},
		});
		expect(input.plan).toEqual({ engine: 'native', capture: 'typed' });
	});

	test('a network error stays on native and keeps the transcript', () => {
		const recognition = new FakeRecognition();
		const titles: string[] = [];
		const ends: string[] = [];
		startVoiceInput({
			choice: 'native',
			online: false,
			nativeSpeech: true,
			createRecognition: () => recognition,
			ramble: { now },
			onDraft: draft => titles.push(...draft.tasks.map(task => task.title)),
			onEnd: reason => ends.push(reason),
		});
		recognition.say([{ transcript: 'Buy milk', isFinal: true }]);
		recognition.fail('network');
		expect(titles).toEqual(['Buy milk']);
		expect(ends).toEqual(['error']);
	});
});
