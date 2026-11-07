import { expect } from 'bun:test';
import * as transcript from './transcript.ts';
import { describe, recorded, test } from '../vectors/record.ts';

const joinTranscript = recorded('ramble-transcript', transcript.joinTranscript);
const caption = recorded('ramble-transcript', transcript.caption);

describe('joinTranscript', () => {
	test('joins a partial after the committed text', () => {
		expect(joinTranscript('Buy milk', 'tomorrow')).toEqual({ text: 'Buy milk tomorrow', partialStart: 9 });
		expect(joinTranscript('Buy milk ', 'tomorrow')).toEqual({ text: 'Buy milk tomorrow', partialStart: 9 });
		expect(joinTranscript('', '  buy milk  ')).toEqual({ text: 'buy milk', partialStart: 0 });
		expect(joinTranscript('Buy milk', '')).toEqual({ text: 'Buy milk', partialStart: 8 });
	});
});

describe('caption', () => {
	test('tints metadata by kind and spoken commands as commands', () => {
		const text = 'buy milk tomorrow next task call mom';
		expect(
			caption(text, [
				{ kind: 'separator', start: 18, end: 27, text: 'next task' },
				{ kind: 'due', start: 9, end: 17, text: 'tomorrow' },
			]),
		).toEqual([
			{ text: 'buy milk ', kind: null },
			{ text: 'tomorrow', kind: 'due' },
			{ text: ' ', kind: null },
			{ text: 'next task', kind: 'command' },
			{ text: ' call mom', kind: null },
		]);
	});

	test('a long transcript shows its end, cut at a word, and a token cut at the start keeps its tail', () => {
		const text = 'one two three four five';
		expect(caption(text, [{ kind: 'priority', start: 4, end: 13, text: 'two three' }], 12)).toEqual([
			{ text: '… ', kind: null },
			{ text: 'four five', kind: null },
		]);
		expect(caption(text, [{ kind: 'priority', start: 8, end: 18, text: 'three four' }], 12)).toEqual([
			{ text: '… ', kind: null },
			{ text: 'four', kind: 'priority' },
			{ text: ' five', kind: null },
		]);
	});

	test('an empty transcript has no parts', () => {
		expect(caption('', [])).toEqual([]);
	});
});
