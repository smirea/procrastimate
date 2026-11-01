import { z } from 'zod';
import { rangeSchema, type Range } from './search.ts';

const offset = z.number().int();

export const textSegmentSchema = z
	.object({
		text: z.string(),
		href: z.string().nullable(),
		start: offset,
		end: offset,
		marks: z.array(rangeSchema).meta({ 'x-swift-type': '[Range<Int>]' }),
	})
	.meta({
		id: 'TextSegment',
		description:
			'A run of displayed text, a link when `href` is set. `start` and `end` span the source, including a Markdown link’s brackets and URL. `marks` are the highlight ranges within `text`.',
	});
export type TextSegment = z.infer<typeof textSegmentSchema>;

/**
 * A Markdown `[label](url)`, as Todoist exports links, or a bare `http(s)://` or `www.` address. Only web URLs count,
 * and bare domains such as `example.com` do not, since `file.txt` or `v1.2` would read as one.
 */
const LINK = /\[([^[\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)|(?<![\w.@/])(?:https?:\/\/|www\.)[^\s<>"]+/gi;

const TRAILING = /[.,;:!?'"*_]/;

/** Sentence punctuation after a bare URL ends it, and so does a closing bracket it never opened, as in `(see https://a.com)`. */
function trimBare(url: string): string {
	let end = url.length;
	for (;;) {
		const last = url[end - 1]!;
		const body = url.slice(0, end);
		if (TRAILING.test(last)) end--;
		else if (last === ')' && body.split('(').length < body.split(')').length) end--;
		else if (last === ']' && body.split('[').length < body.split(']').length) end--;
		else return body;
	}
}

/**
 * Splits text into plain runs and links, for display. Highlight `ranges` over the source text become each segment's
 * `marks`, and a Markdown link's marks fall on its label.
 */
export function linkify(text: string, ranges: readonly Range[] = []): TextSegment[] {
	const segments: TextSegment[] = [];
	const push = (display: string, href: string | null, start: number, end: number, at: number) => {
		if (!display) return;
		const marks = ranges.flatMap(([s, e]): Range[] => {
			const from = Math.max(s - at, 0);
			const to = Math.min(e - at, display.length);
			return from < to ? [[from, to]] : [];
		});
		segments.push({ text: display, href, start, end, marks });
	};
	let cursor = 0;
	for (const match of text.matchAll(LINK)) {
		const start = match.index;
		const [label, target] = [match[1], match[2]];
		const url = label === undefined ? trimBare(match[0]) : match[0];
		if (label === undefined && /^(?:https?:\/\/|www\.)$/i.test(url)) continue;
		const end = start + url.length;
		push(text.slice(cursor, start), null, cursor, start, cursor);
		if (label !== undefined) push(label, target!, start, end, start + 1);
		else push(url, /^www\./i.test(url) ? `https://${url}` : url, start, end, start);
		cursor = end;
	}
	push(text.slice(cursor), null, cursor, text.length, cursor);
	return segments;
}

/** A link's icon, fetched by the server from the link's host. See `docs/decisions/link-previews.md`. */
export const FAVICON_PATH = '/api/favicon';

/** The host whose icon a link shows, lowercased, or null for an href that does not parse. */
export function linkHost(href: string): string | null {
	return URL.parse(href)?.hostname.toLowerCase() || null;
}

/** The pasted text, trimmed, when it is one bare web URL and nothing else, the paste that becomes a titled link. */
export function pastedUrl(pasted: string): string | null {
	const text = pasted.trim();
	const segments = linkify(text);
	const only = segments[0];
	return segments.length === 1 && only?.href && only.text === text ? text : null;
}

/**
 * `text` with the bare `url` pasted at `at` turned into `[title](url)`, once the page's title arrives. Null when the
 * text no longer holds that bare URL there, or the title leaves no label. Brackets in the title become parentheses, the
 * only characters a Markdown label cannot hold.
 */
export function titleLink(text: string, at: number, url: string, title: string): string | null {
	const label = title.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim();
	const bare = linkify(text).find(s => s.start === at);
	if (!label || !bare?.href || bare.text !== url || bare.end !== at + url.length) return null;
	const link = `[${label}](${bare.href})`;
	const next = text.slice(0, at) + link + text.slice(bare.end);
	const titled = linkify(next).find(s => s.start === at);
	return titled?.text === label && titled.end === at + link.length ? next : null;
}
