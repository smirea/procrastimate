import { expect } from 'bun:test';
import { voiceCapture, type DictationChoice } from './dictation.ts';
import { describe, recorded, test } from './vectors/record.ts';

const capture = recorded('dictation', voiceCapture);

const choices = [['native'], ['elevenlabs'], ['gemini']] as const satisfies ReadonlyArray<readonly [DictationChoice]>;

describe('voiceCapture', () => {
	test.each(choices)('%s stays native while offline, and uses speech when the platform has it', choice => {
		expect(capture(choice, false, true)).toEqual({ engine: 'native', capture: 'speech' });
	});

	test.each(choices)('%s stays native while offline, and types when the platform has no recognizer', choice => {
		expect(capture(choice, false, false)).toEqual({ engine: 'native', capture: 'typed' });
	});

	test('native uses the platform recognizer while online', () => {
		expect(capture('native', true, true)).toEqual({ engine: 'native', capture: 'speech' });
	});

	test('native types when the browser has no SpeechRecognition', () => {
		expect(capture('native', true, false)).toEqual({ engine: 'native', capture: 'typed' });
	});

	test('elevenlabs uses the server socket only while online', () => {
		expect(capture('elevenlabs', true, true)).toEqual({ engine: 'elevenlabs', capture: 'socket' });
		expect(capture('elevenlabs', true, false)).toEqual({ engine: 'elevenlabs', capture: 'socket' });
	});

	test('gemini streams to the server socket for Gemini Live only while online', () => {
		expect(capture('gemini', true, true)).toEqual({ engine: 'gemini', capture: 'socket' });
		expect(capture('gemini', true, false)).toEqual({ engine: 'gemini', capture: 'socket' });
	});
});
