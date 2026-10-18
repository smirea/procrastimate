import { describe, expect, test } from 'bun:test';
import {
	dictationText,
	NativeDictation,
	type DictationEnd,
	type SpeechPiece,
	type SpeechSession,
} from './dictation.ts';

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

function listen() {
	const texts: string[] = [];
	const ends: DictationEnd[] = [];
	const sessions: FakeRecognition[] = [];
	const dictation = new NativeDictation(
		text => texts.push(text),
		reason => ends.push(reason),
	);
	dictation.start(() => {
		const session = new FakeRecognition();
		sessions.push(session);
		return session;
	});
	return { dictation, texts, ends, sessions };
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

describe('NativeDictation', () => {
	test('a continuous English session reports each transcript and stops on request', () => {
		const { dictation, texts, ends, sessions } = listen();
		const [session] = sessions;
		expect([session!.lang, session!.continuous, session!.interimResults, session!.started]).toEqual([
			'en-US',
			true,
			true,
			1,
		]);
		session!.say([{ transcript: 'Buy milk', isFinal: true }]);
		session!.say([
			{ transcript: 'Buy milk', isFinal: true },
			{ transcript: ' and', isFinal: false },
		]);
		expect(texts).toEqual(['Buy milk', 'Buy milk and']);
		dictation.stop();
		expect([session!.stopped, ends]).toEqual([1, ['stopped']]);
	});

	test('a session the browser ends on its own restarts and keeps the committed text', () => {
		const { texts, sessions } = listen();
		sessions[0]!.say([{ transcript: 'Buy milk', isFinal: true }]);
		sessions[0]!.onend?.();
		expect(sessions.length).toBe(2);
		sessions[1]!.say([{ transcript: ' Call mom', isFinal: true }]);
		expect(texts.at(-1)).toBe('Buy milk Call mom');
	});

	test('a refused microphone ends with denied, and a network error with error', () => {
		const denied = listen();
		denied.sessions[0]!.fail('not-allowed');
		expect(denied.ends).toEqual(['denied']);
		const failed = listen();
		failed.sessions[0]!.fail('network');
		expect(failed.ends).toEqual(['error']);
	});

	test('three sessions that end at once in a row give up with error', () => {
		const { ends, sessions } = listen();
		for (let i = 0; i < 3; i++) sessions[i]!.onend?.();
		expect([sessions.length, ends]).toEqual([3, ['error']]);
	});

	test('a browser without a recognizer ends with unsupported', () => {
		const ends: DictationEnd[] = [];
		new NativeDictation(
			() => {},
			reason => ends.push(reason),
		).start(() => null);
		expect(ends).toEqual(['unsupported']);
	});
});
