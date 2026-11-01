import { expect } from 'bun:test';
import * as links from './links.ts';
import type { TextSegment } from './links.ts';
import { describe, recorded, test } from './vectors/record.ts';

const linkify = recorded('links', links.linkify);
const pastedUrl = recorded('links', links.pastedUrl);
const titleLink = recorded('links', links.titleLink);

/** `[text](href)` for a link and the bare text otherwise, so a table row reads like what the user sees. */
const shown = (segments: TextSegment[]) => segments.map(s => (s.href ? `[${s.text}](${s.href})` : s.text)).join('|');

describe('linkify', () => {
	test.each([
		['Buy milk', 'Buy milk'],
		['', ''],
		['Read https://example.com/a?b=1#top', 'Read |[https://example.com/a?b=1#top](https://example.com/a?b=1#top)'],
		['http://x.dev', '[http://x.dev](http://x.dev)'],
		['Visit www.site.com/path today', 'Visit |[www.site.com/path](https://www.site.com/path)| today'],
		['See https://a.com.', 'See |[https://a.com](https://a.com)|.'],
		['(see https://a.com/x)', '(see |[https://a.com/x](https://a.com/x)|)'],
		[
			'https://en.wikipedia.org/wiki/Foo_(bar) ok',
			'[https://en.wikipedia.org/wiki/Foo_(bar)](https://en.wikipedia.org/wiki/Foo_(bar))| ok',
		],
		['Two: https://a.com, https://b.com!', 'Two: |[https://a.com](https://a.com)|, |[https://b.com](https://b.com)|!'],
		['cancel [meetup.com](https://meetup.com)', 'cancel |[meetup.com](https://meetup.com)'],
		['[Doc (draft)](https://d.co/x_(1)) now', '[Doc (draft)](https://d.co/x_(1))| now'],
		['HTTPS://LOUD.COM', '[HTTPS://LOUD.COM](HTTPS://LOUD.COM)'],
	])('%p reads as %p', (text, expected) => {
		expect(shown(linkify(text))).toBe(expected);
	});

	test.each([
		['bare domains stay text', 'Fix example.com and file.txt'],
		['an email stays text', 'Email me@www.site.com'],
		['a scheme with nothing after it stays text', 'Type https:// here'],
		['www. alone stays text', 'the www. prefix'],
		['a scheme inside a word stays text', 'xhttps://a.com'],
		['a non-web Markdown link stays text', '[app](todoist://task?id=1)'],
		['a Markdown link without a URL stays text', '[todo] (later)'],
	])('%s', (_, text) => {
		expect(shown(linkify(text))).toBe(text);
	});

	test('segments span the source, so a Markdown link covers its brackets and URL', () => {
		expect(linkify('a [b](https://c.d) e')).toEqual([
			{ text: 'a ', href: null, start: 0, end: 2, marks: [] },
			{ text: 'b', href: 'https://c.d', start: 2, end: 18, marks: [] },
			{ text: ' e', href: null, start: 18, end: 20, marks: [] },
		]);
	});

	test('highlight ranges become marks within each segment, on a Markdown link’s label', () => {
		expect(
			linkify('meet [meetup.com](https://meetup.com) up', [
				[0, 4],
				[6, 10],
				[37, 40],
			]),
		).toEqual([
			{ text: 'meet ', href: null, start: 0, end: 5, marks: [[0, 4]] },
			{ text: 'meetup.com', href: 'https://meetup.com', start: 5, end: 37, marks: [[0, 4]] },
			{ text: ' up', href: null, start: 37, end: 40, marks: [[0, 3]] },
		]);
		expect(linkify('go https://a.com', [[1, 8]])).toEqual([
			{ text: 'go ', href: null, start: 0, end: 3, marks: [[1, 3]] },
			{ text: 'https://a.com', href: 'https://a.com', start: 3, end: 16, marks: [[0, 5]] },
		]);
	});

	test('offsets count UTF-16 code units, as JavaScript strings do', () => {
		expect(linkify('🎉 https://a.com 🎉')).toEqual([
			{ text: '🎉 ', href: null, start: 0, end: 3, marks: [] },
			{ text: 'https://a.com', href: 'https://a.com', start: 3, end: 16, marks: [] },
			{ text: ' 🎉', href: null, start: 16, end: 19, marks: [] },
		]);
	});
});

describe('pastedUrl', () => {
	test.each([
		['https://example.com/a?b=1', 'https://example.com/a?b=1'],
		['  https://example.com/a\n', 'https://example.com/a'],
		['www.site.com/path', 'www.site.com/path'],
		['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
	])('%p pastes as %p', (pasted, url) => {
		expect(pastedUrl(pasted)).toBe(url);
	});

	test.each([
		['text around the URL', 'see https://a.com'],
		['two URLs', 'https://a.com https://b.com'],
		['a Markdown link', '[a](https://a.com)'],
		['trailing punctuation the link leaves out', 'https://a.com.'],
		['a bare domain', 'example.com'],
		['plain text', 'Buy milk'],
	])('%s is not a pasted URL', (_, pasted) => {
		expect(pastedUrl(pasted)).toBeNull();
	});
});

describe('titleLink', () => {
	test.each([
		['Read https://a.com/x later', 5, 'https://a.com/x', 'The X page', 'Read [The X page](https://a.com/x) later'],
		['https://a.com', 0, 'https://a.com', '  A \n  site  ', '[A site](https://a.com)'],
		['www.site.com', 0, 'www.site.com', 'Site', '[Site](https://www.site.com)'],
		['https://a.com', 0, 'https://a.com', 'Array[0] docs', '[Array(0) docs](https://a.com)'],
		['🎉 https://a.com', 3, 'https://a.com', 'A', '🎉 [A](https://a.com)'],
	])('%p at %p with %p titled %p reads %p', (text, at, url, title, expected) => {
		expect(titleLink(text, at, url, title)).toBe(expected);
	});

	test.each([
		['the URL moved', 'x https://a.com', 0, 'https://a.com', 'A'],
		['the URL was edited', 'https://a.com/more', 0, 'https://a.com', 'A'],
		['the URL is gone', 'Buy milk', 0, 'https://a.com', 'A'],
		['the title is blank', 'https://a.com', 0, 'https://a.com', '   '],
		['the URL already sits in a Markdown link', '[x](https://a.com)', 0, 'https://a.com', 'A'],
	])('%s leaves the text alone', (_, text, at, url, title) => {
		expect(titleLink(text, at, url, title)).toBeNull();
	});
});
