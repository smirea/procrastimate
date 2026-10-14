import { z } from 'zod';
import type { Task } from './task.ts';

export type Named = { id: string; name: string };

export const sigilSchema = z.enum(['#', '@']).meta({ id: 'Sigil', 'x-enum-names': ['project', 'label'] });
export type Sigil = z.infer<typeof sigilSchema>;

const offset = z.number().int();

export const sigilFragmentSchema = z.object({ start: offset, end: offset, query: z.string() }).meta({
	id: 'SigilFragment',
	description:
		'The `#query` or `@query` the caret sits in. `start` is the sigil, `end` is the end of the word under the caret.',
});
export type SigilFragment = z.infer<typeof sigilFragmentSchema>;

export type Suggestion<T extends Named> = { kind: 'existing'; item: T } | { kind: 'create'; name: string };

/**
 * A sigil starts a fragment at the start of the text or after whitespace, so `a@b.com` and `Issue#12`
 * never do. The query may contain spaces only while it still prefixes a name, so multi-word names stay searchable.
 * Trailing sentence punctuation ends it, as it ends a parsed name, so `@calls,` never offers to create `calls,`.
 */
export function sigilFragment(
	value: string,
	caret: number,
	sigil: Sigil,
	items: readonly Named[],
): SigilFragment | null {
	const before = value.slice(0, caret);
	const start = before.lastIndexOf(sigil);
	if (start === -1 || (start > 0 && !/\s/.test(before[start - 1]!))) return null;
	const query = before.slice(start + 1);
	if (/[,.;:!?)]$/.test(query)) return null;
	if (/\s/.test(query)) {
		const lower = query.toLowerCase();
		if (!items.some(item => item.name.toLowerCase().startsWith(lower))) return null;
	}
	return { start, end: caret + /^\S*/.exec(value.slice(caret))![0].length, query };
}

export const unknownNameSchema = z
	.object({ sigil: sigilSchema, name: z.string(), start: offset, end: offset })
	.meta({ id: 'UnknownName', description: 'A `#name` or `@name` in the text that names no project or label yet.' });
export type UnknownName = z.infer<typeof unknownNameSchema>;

const SIGIL_WORD = /(?<!\S)([#@])([\p{L}\p{N}_-]+)(?=[,.;:!?)]*(?:\s|$))/gu;

/**
 * Every `#name` and `@name` that quick add could offer to create: a sigil at the start of the text or after
 * whitespace, then a word of letters, digits, `_`, or `-` that ends at whitespace or the end, after any sentence punctuation,
 * so `@calls,` offers `calls` and `@site.com` offers nothing.
 * Text the parser already claimed is skipped, so `#Side Project` never offers `#Side`, and so is a name that exists
 * ignoring case, including one kept as text. Each name is offered once, at its first mention.
 */
export function unknownNames(
	value: string,
	tokens: readonly { start: number; end: number }[],
	projects: readonly Named[],
	labels: readonly Named[],
): UnknownName[] {
	const found: UnknownName[] = [];
	const seen = new Set<string>();
	for (const match of value.matchAll(SIGIL_WORD)) {
		const sigil = match[1] as Sigil;
		const name = match[2]!;
		const start = match.index;
		if (tokens.some(token => start >= token.start && start < token.end)) continue;
		const lower = name.toLowerCase();
		const items = sigil === '#' ? projects : labels;
		if (items.some(item => item.name.toLowerCase() === lower)) continue;
		const key = sigil + lower;
		if (seen.has(key)) continue;
		seen.add(key);
		found.push({ sigil, name, start, end: start + 1 + name.length });
	}
	return found;
}

export function lastUsed(tasks: readonly Task[], idsOf: (task: Task) => readonly string[]): Map<string, number> {
	const used = new Map<string, number>();
	for (const task of tasks) {
		for (const id of idsOf(task)) {
			if (task.createdAt > (used.get(id) ?? 0)) used.set(id, task.createdAt);
		}
	}
	return used;
}

export const projectIdsOf = (task: Task) => (task.projectId ? [task.projectId] : []);
export const labelIdsOf = (task: Task) => task.labelIds;

/** 0 exact, 1 prefix, 2 word prefix, 3 substring, null no match. */
function matchTier(name: string, query: string): number | null {
	const n = name.toLowerCase();
	if (n === query) return 0;
	if (n.startsWith(query)) return 1;
	if (n.split(/\s+/).some(word => word.startsWith(query))) return 2;
	return n.includes(query) ? 3 : null;
}

export function suggest<T extends Named>(
	items: readonly T[],
	used: ReadonlyMap<string, number>,
	query: string,
): Suggestion<T>[] {
	const q = query.trim().toLowerCase();
	const ranked = items
		.map(item => ({ item, tier: matchTier(item.name, q) }))
		.filter((r): r is { item: T; tier: number } => r.tier !== null)
		.toSorted(
			(a, b) =>
				a.tier - b.tier ||
				(used.get(b.item.id) ?? 0) - (used.get(a.item.id) ?? 0) ||
				a.item.name.localeCompare(b.item.name, 'en-US', { sensitivity: 'base' }),
		);
	const suggestions: Suggestion<T>[] = ranked.map(r => ({ kind: 'existing', item: r.item }));
	if (q && ranked[0]?.tier !== 0) suggestions.push({ kind: 'create', name: query.trim() });
	return suggestions;
}
