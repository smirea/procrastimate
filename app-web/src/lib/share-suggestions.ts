import { namePrefixed, type Person } from 'shared/sharing.ts';

/**
 * Who the share sheet offers for `q`: people the space has already met match at once, and the server's answer for the
 * same query joins them once it lands. Neither offers this user or anyone the list is already shared with.
 */
export function shareSuggestions({
	q,
	me,
	known,
	found,
	granted,
}: {
	q: string;
	me: string | null;
	known: Person[];
	found: { q: string; people: Person[] } | null;
	granted: string[];
}): Person[] {
	if (!q) return [];
	const local = known.filter(p => p.id !== me && namePrefixed(p.name, q));
	const remote = found?.q === q ? found.people : [];
	const all = [...local, ...remote.filter(p => !local.some(k => k.id === p.id))];
	return all.filter(p => !granted.includes(p.id));
}
