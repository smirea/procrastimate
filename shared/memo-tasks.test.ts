import { expect } from 'bun:test';
import * as memo from './memo-tasks.ts';
import { describe, recorded, test } from './vectors/record.ts';

const memoSourceKey = recorded('memo-tasks', memo.memoSourceKey);
const parseMemoSource = recorded('memo-tasks', memo.parseMemoSource);

const MEMO = '0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d';
const KEY = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('memo source keys', () => {
	test('build and parse back', () => {
		const key = memoSourceKey({ memoId: MEMO, taskKey: KEY });
		expect(key).toBe(`voicememo:${MEMO}:${KEY}`);
		expect(parseMemoSource(key)).toEqual({ memoId: MEMO, taskKey: KEY });
	});

	test.each([
		[undefined],
		[null],
		[''],
		['todoist:task:6Xmpl1Fq:Call the dentist'],
		[`voicememo:${MEMO}`],
		[`voicememo:${MEMO}:`],
		[`voicememo:${MEMO}:${KEY}:extra`],
		[`voicememo:${MEMO.toUpperCase()}:${KEY}`],
		[`voicememo:not-a-uuid:${KEY}`],
	])('%p is not a memo task', sourceKey => {
		expect(parseMemoSource(sourceKey)).toBeNull();
	});
});
