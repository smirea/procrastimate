import { expect } from 'bun:test';
import * as github from './github.ts';
import { describe, recorded, test } from './vectors/record.ts';

const parseGithubRef = recorded('github', github.parseGithubRef);
const githubUrl = recorded('github', github.githubUrl);
const githubLabel = recorded('github', github.githubLabel);
const withGithubRef = recorded('github', github.withGithubRef);

const pull = { repo: 'smirea/procrastimate', number: 309, kind: 'pull' } as const;
const issue = { repo: 'oven-sh/bun', number: 1, kind: 'issue' } as const;

describe('parseGithubRef', () => {
	test.each([
		['https://github.com/smirea/procrastimate/pull/309', pull],
		['  https://www.github.com/smirea/procrastimate/pull/309/files?w=1#diff  ', pull],
		['github.com/smirea/procrastimate/pull/309', pull],
		['https://github.com/oven-sh/bun/issues/1', issue],
		['oven-sh/bun#1', issue],
		['HTTPS://GITHUB.COM/oven-sh/bun/ISSUES/1', issue],
		['https://github.com/oven-sh/bun', null],
		['https://github.com/oven-sh/bun/pull/0', null],
		['https://gitlab.com/a/b/issues/1', null],
		['see https://github.com/oven-sh/bun/issues/1', null],
		['bun#1', null],
	])('%p reads as %p', (text, ref) => {
		expect(parseGithubRef(text)).toEqual(ref);
	});
});

describe('githubUrl and githubLabel', () => {
	test('a pull request and an issue', () => {
		expect(githubUrl(pull)).toBe('https://github.com/smirea/procrastimate/pull/309');
		expect(githubUrl(issue)).toBe('https://github.com/oven-sh/bun/issues/1');
		expect(githubLabel(pull)).toBe('procrastimate#309');
	});
});

describe('withGithubRef', () => {
	test('adds a new one last, and keeps a repeat once whatever its kind or case', () => {
		expect(withGithubRef([issue], pull)).toEqual([issue, pull]);
		expect(withGithubRef([pull], { repo: 'Smirea/Procrastimate', number: 309, kind: 'issue' })).toEqual([pull]);
	});
});
