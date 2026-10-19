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

type Field = HTMLTextAreaElement | HTMLInputElement;

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function isField(node: EventTarget | null): node is Field {
	return node instanceof HTMLTextAreaElement || (node instanceof HTMLInputElement && TEXT_INPUTS.has(node.type));
}

function scroller(field: HTMLElement): HTMLElement | null {
	for (let node = field.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === 'auto' || overflowY === 'scroll') return node;
	}
	return null;
}

/** Scrolls a textarea at its height cap so the caret's line shows inside it. */
function scrollInside(field: HTMLTextAreaElement) {
	if (field.scrollHeight <= field.clientHeight + 1) return;
	const bottom = caretBottom(field);
	const line = parseFloat(getComputedStyle(field).lineHeight) || 20;
	if (bottom > field.scrollTop + field.clientHeight) field.scrollTop = bottom - field.clientHeight + 2;
	else if (bottom - line < field.scrollTop) field.scrollTop = Math.max(0, bottom - line - 2);
}

/** How far the caret's line sits outside what `outer` shows above the keyboard: positive below, negative above. */
function overflow(field: Field, outer: HTMLElement): number {
	const rect = field.getBoundingClientRect();
	let top = rect.top;
	let bottom = rect.bottom;
	if (field instanceof HTMLTextAreaElement) {
		bottom = rect.top + caretBottom(field) - field.scrollTop;
		top = bottom - (parseFloat(getComputedStyle(field).lineHeight) || 20);
	}
	const box = outer.getBoundingClientRect();
	const viewport = window.visualViewport;
	const visibleTop = Math.max(box.top, viewport?.offsetTop ?? 0);
	const visibleBottom = Math.min(box.bottom, viewport ? viewport.offsetTop + viewport.height : window.innerHeight);
	const margin = 12;
	if (bottom + margin > visibleBottom) return bottom + margin - visibleBottom;
	if (top - margin < visibleTop) return top - margin - visibleTop;
	return 0;
}

function follow(field: Field) {
	const outer = scroller(field);
	let following = true;
	let placed = outer?.scrollTop ?? 0;
	const reveal = () => {
		if (document.activeElement !== field) return;
		if (field instanceof HTMLTextAreaElement) scrollInside(field);
		if (!outer || !following) return;
		const delta = overflow(field, outer);
		if (Math.abs(delta) < 1) return;
		outer.scrollTop += delta;
		placed = outer.scrollTop;
	};
	const edited = () => {
		following = true;
		reveal();
	};
	// Only a scroll this code didn't make is the user's, and one that leaves the caret out of view stops the following.
	const scrolled = () => {
		if (outer && Math.abs(outer.scrollTop - placed) > 1) following = overflow(field, outer) === 0;
	};
	const resized = new ResizeObserver(reveal);
	resized.observe(field);
	if (outer) for (const child of outer.children) resized.observe(child);
	field.addEventListener('input', edited);
	outer?.addEventListener('scroll', scrolled);
	window.visualViewport?.addEventListener('resize', reveal);
	return () => {
		resized.disconnect();
		field.removeEventListener('input', edited);
		outer?.removeEventListener('scroll', scrolled);
		window.visualViewport?.removeEventListener('resize', reveal);
	};
}

/**
 * Keeps the focused field's caret in view whenever the layout around it moves, not only when its own text changes: a
 * subtask inserted above `Add subtask`, a field growing a line, a paste into a field at its height cap, the keyboard
 * opening. Patching each field on its own input events missed every other move. Resize observers run after layout and
 * before paint, so the scroll lands in the same frame as the change. Once the user scrolls the caret away themselves,
 * layout changes leave the page alone until the next edit.
 */
export function keepCaretInView() {
	let detach: (() => void) | undefined;
	const focused = (event: FocusEvent) => {
		detach?.();
		detach = isField(event.target) ? follow(event.target) : undefined;
	};
	const blurred = (event: FocusEvent) => {
		if (isField(event.target) && !isField(event.relatedTarget)) {
			detach?.();
			detach = undefined;
		}
	};
	document.addEventListener('focusin', focused);
	document.addEventListener('focusout', blurred);
	return () => {
		document.removeEventListener('focusin', focused);
		document.removeEventListener('focusout', blurred);
		detach?.();
	};
}
