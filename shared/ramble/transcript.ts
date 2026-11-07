import type { TokenKind } from '../quick-add.ts';
import type { RambleToken } from '../ramble.ts';

/** The committed transcript with the live partial after it, and where the partial starts, in UTF-16 units. */
export function joinTranscript(committed: string, partial: string): { text: string; partialStart: number } {
	const tail = partial.trim();
	if (!committed) return { text: tail, partialStart: 0 };
	if (!tail) return { text: committed, partialStart: committed.length };
	const gap = committed.endsWith(' ') || tail.startsWith(' ') ? '' : ' ';
	return { text: committed + gap + tail, partialStart: committed.length + gap.length };
}

const METADATA = new Set<string>([
	'due',
	'recurrence',
	'priority',
	'reminder',
	'project',
	'label',
] satisfies TokenKind[]);

export type CaptionPart = { text: string; kind: TokenKind | 'command' | null };

/**
 * The end of the transcript, cut at a word, split so recognized phrases can be tinted: metadata by its kind, and
 * spoken commands such as `next task` or `scratch that` as commands.
 */
export function caption(transcript: string, tokens: readonly RambleToken[], limit = 140): CaptionPart[] {
	let from = Math.max(0, transcript.length - limit);
	if (from > 0) from = transcript.indexOf(' ', from) + 1 || from;
	const parts: CaptionPart[] = from > 0 ? [{ text: '… ', kind: null }] : [];
	let cursor = from;
	for (const token of tokens.toSorted((a, b) => a.start - b.start)) {
		if (token.end <= cursor) continue;
		const start = Math.max(token.start, cursor);
		if (start > cursor) parts.push({ text: transcript.slice(cursor, start), kind: null });
		parts.push({
			text: transcript.slice(start, token.end),
			kind: METADATA.has(token.kind) ? (token.kind as TokenKind) : 'command',
		});
		cursor = token.end;
	}
	if (cursor < transcript.length) parts.push({ text: transcript.slice(cursor), kind: null });
	return parts;
}
