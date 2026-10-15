import type { RambleTask, RambleToken } from 'shared/ramble.ts';
import type { TokenKind } from 'shared/quick-add.ts';

/** A spoken task in the drawer. Its key survives reparsing and the move from live to reviewed, so rows never remount. */
export type RambleEntry = Omit<RambleTask, 'segment' | 'subtasks'> & { key: string; subtasks: RambleEntry[] };

/**
 * Keys a parse. The grammar reparses the whole transcript on each update and a ramble only grows at its end, so the
 * task at a given position is the same task from one update to the next.
 */
export function keyed(tasks: readonly RambleTask[], base: number): RambleEntry[] {
	const entry = ({ segment: _, subtasks, ...task }: RambleTask, key: string): RambleEntry => ({
		...task,
		key,
		subtasks: subtasks.map((subtask, i) => entry(subtask, `${key}.${i}`)),
	});
	return tasks.map((task, i) => entry(task, String(base + i)));
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
