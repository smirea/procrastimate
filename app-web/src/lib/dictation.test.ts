import { describe, expect, test } from 'bun:test';
import { dictationText } from './dictation.ts';

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
