import { GAP, MARGIN } from './placement.ts';

const INTERACTIVE =
	'button, a[href], [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="tab"], [role="radio"]';

/**
 * What a hover tooltip says for the element under the pointer, and the element it anchors to. `data-tooltip` names it
 * outright (a chip whose text is a count, a control whose label needs more words). Otherwise any control that shows only
 * an icon gets its accessible name, so a new icon button gets a tooltip by having the `aria-label` it needs anyway.
 * `data-tooltip="off"` opts a control out.
 */
export function tooltipFor(target: Element): { anchor: HTMLElement; text: string } | null {
	const control = target.closest<HTMLElement>(`[data-tooltip], ${INTERACTIVE}`);
	if (!control) return null;
	const explicit = control.dataset.tooltip;
	if (explicit === 'off') return null;
	if (explicit) return { anchor: control, text: explicit };
	if (!iconOnly(control)) return null;
	const text = control.getAttribute('aria-label') ?? control.title;
	if (text) return { anchor: control, text };
	if (import.meta.env.DEV)
		console.error('An icon-only control has no aria-label, so it has no tooltip or accessible name.', control);
	return null;
}

/** An icon and no visible text. A row's full-size button under its title holds no icon, so it is not one. */
function iconOnly(control: HTMLElement) {
	return !control.textContent?.trim() && control.querySelector('svg, img') !== null;
}

/** Centered below its anchor, above when the viewport has no room below, and kept inside the viewport's sides. */
export function placeTooltip(
	anchor: DOMRect,
	size: { width: number; height: number },
	viewport: { width: number; height: number },
) {
	const below = anchor.bottom + GAP + size.height + MARGIN <= viewport.height;
	const top = below ? anchor.bottom + GAP : anchor.top - GAP - size.height;
	const centered = anchor.left + anchor.width / 2 - size.width / 2;
	const left = Math.min(Math.max(MARGIN, centered), viewport.width - MARGIN - size.width);
	return { top: Math.round(top), left: Math.round(left), below };
}
