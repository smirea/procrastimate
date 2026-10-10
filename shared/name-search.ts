import type { Task } from './task.ts';

/** Anything picked by name after a sigil: projects after `#`, labels after `@`. */
export type Named = { id: string; name: string };

export type Sigil = '#' | '@';

/** The `#query` or `@query` the caret sits in. `start` is the sigil, `end` is the end of the word under the caret. */
export type SigilFragment = { start: number; end: number; query: string };

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

/** When each id last appeared on a newly created task, the store's only record of use. */
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

/** Best match first, then most recently used, then alphabetical. Offers to create the query when no name equals it. */
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
				a.item.name.localeCompare(b.item.name, undefined, { sensitivity: 'base' }),
		);
	const suggestions: Suggestion<T>[] = ranked.map(r => ({ kind: 'existing', item: r.item }));
	if (q && ranked[0]?.tier !== 0) suggestions.push({ kind: 'create', name: query.trim() });
	return suggestions;
}
