/** Space between a panel and its anchor, and between a panel and the viewport's edge. */
export const GAP = 6;
export const MARGIN = 8;

/** The visible height, which shrinks above an on-screen keyboard. */
export const viewportHeight = () => window.visualViewport?.height ?? window.innerHeight;

/**
 * Which side of an anchor a panel opens on: the preferred one unless the panel needs more room than it has there
 * and the other side has more. Answers the room it gets.
 */
export function fitVertical(
	room: { above: number; below: number },
	needed: number,
	prefer: 'above' | 'below',
): { above: boolean; maxHeight: number } {
	const preferred = room[prefer];
	const other = prefer === 'above' ? room.below : room.above;
	const flip = needed > preferred && other > preferred;
	const above = prefer === 'above' ? !flip : flip;
	return { above, maxHeight: above ? room.above : room.below };
}
