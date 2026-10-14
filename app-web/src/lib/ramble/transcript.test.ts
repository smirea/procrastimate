import { describe, expect, test } from 'bun:test';
import { joinTranscript } from './transcript.ts';

describe('joinTranscript', () => {
	test('joins a partial after the committed text', () => {
		expect(joinTranscript('Buy milk', 'tomorrow')).toEqual({ text: 'Buy milk tomorrow', partialStart: 9 });
		expect(joinTranscript('', '  buy milk  ')).toEqual({ text: 'buy milk', partialStart: 0 });
		expect(joinTranscript('Buy milk', '')).toEqual({ text: 'Buy milk', partialStart: 8 });
	});
});
