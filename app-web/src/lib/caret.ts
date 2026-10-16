const MIRRORED = [
	'boxSizing',
	'width',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'borderTopWidth',
	'borderRightWidth',
	'borderBottomWidth',
	'borderLeftWidth',
	'fontFamily',
	'fontSize',
	'fontWeight',
	'fontStyle',
	'letterSpacing',
	'lineHeight',
	'textTransform',
	'wordSpacing',
	'tabSize',
	'whiteSpace',
	'overflowWrap',
	'wordBreak',
] as const;

/** How far below the field's top edge the caret's line ends, in the field's scrolled content. */
function caretBottom(field: HTMLTextAreaElement): number {
	const mirror = document.createElement('div');
	const style = getComputedStyle(field);
	for (const key of MIRRORED) mirror.style[key] = style[key];
	Object.assign(mirror.style, {
		position: 'absolute',
		visibility: 'hidden',
		top: '0',
		left: '-9999px',
		height: 'auto',
		borderStyle: 'solid',
	});
	// The zero-width space keeps a trailing line break or space from collapsing out of the measurement.
	mirror.textContent = `${field.value.slice(0, field.selectionEnd)}\u200b`;
	document.body.append(mirror);
	const bottom = mirror.offsetHeight - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
	mirror.remove();
	return bottom;
}

function scroller(field: HTMLElement): HTMLElement | null {
	for (let node = field.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
	}
	return null;
}

/**
 * Scrolls the caret's line into view: inside a field that has hit its height cap, and in the sheet around a field that
 * grew past the bottom of the screen or the keyboard. WebKit does neither after a paste or dictation, which hides the
 * caret and the text just inserted; typing scrolls on its own.
 */
export function revealCaret(field: HTMLTextAreaElement) {
	if (document.activeElement !== field) return;
	const bottom = caretBottom(field);
	const line = parseFloat(getComputedStyle(field).lineHeight) || 20;
	if (field.scrollHeight > field.clientHeight + 1) {
		if (bottom > field.scrollTop + field.clientHeight) field.scrollTop = bottom - field.clientHeight + 2;
		else if (bottom - line < field.scrollTop) field.scrollTop = Math.max(0, bottom - line - 2);
	}
	const outer = scroller(field);
	if (!outer) return;
	const caretY = field.getBoundingClientRect().top + bottom - field.scrollTop;
	const viewport = window.visualViewport;
	const visible = Math.min(
		outer.getBoundingClientRect().bottom,
		viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
	);
	const overflow = caretY + 12 - visible;
	if (overflow > 0) outer.scrollTop += overflow;
}

/**
 * Keeps the caret of a growing textarea in view after every edit. It runs in the input event itself, where reading
 * layout already gives the field's new height; a frame later it could undo a scroll the user started meanwhile.
 */
export function followCaret(field: HTMLTextAreaElement) {
	const reveal = () => revealCaret(field);
	field.addEventListener('input', reveal);
	return { destroy: () => field.removeEventListener('input', reveal) };
}
