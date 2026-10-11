/**
 * Fractional sibling positions. A move writes only the moved task's `order`, so two devices that move
 * different siblings never overwrite each other's moves.
 */

type Sibling = { id: string; order: number; createdAt: number };

/** Below this gap a move renumbers its siblings instead of splitting it further. */
export const MIN_ORDER_GAP = 1e-9;

/** By `order`, then `createdAt`, then `id`, so a tie from two concurrent moves settles the same everywhere. */
export const bySiblingOrder = (a: Sibling, b: Sibling) =>
	a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The midpoint of two neighbors, or one past the only neighbor, or `0` with none. */
export function orderBetween(previous: number | null, next: number | null): number {
	if (previous === null) return next === null ? 0 : next - 1;
	if (next === null) return previous + 1;
	return (previous + next) / 2;
}

/**
 * The orders to write to move `id` to `index` among `siblings`: only the moved one's, or each sibling's
 * new position when the gap is below `MIN_ORDER_GAP`. Siblings already in place are left out.
 */
export function moveOrders(siblings: readonly Sibling[], id: string, index: number): { id: string; order: number }[] {
	const moved = siblings.find(s => s.id === id);
	if (!moved) return [];
	const others = siblings.filter(s => s.id !== id).toSorted(bySiblingOrder);
	const at = Math.max(0, Math.min(index, others.length));
	const previous = others[at - 1]?.order ?? null;
	const next = others[at]?.order ?? null;
	const tooClose = previous !== null && next !== null && next - previous < MIN_ORDER_GAP;
	if (!tooClose) {
		return sameSpot(siblings, moved, at) ? [] : [{ id, order: orderBetween(previous, next) }];
	}
	const placed = others.toSpliced(at, 0, moved);
	return placed.flatMap((s, order) => (s.order === order ? [] : [{ id: s.id, order }]));
}

/** Whether the move leaves the sibling where it already sits. */
function sameSpot(siblings: readonly Sibling[], moved: Sibling, at: number) {
	return siblings.toSorted(bySiblingOrder).indexOf(moved) === at;
}
