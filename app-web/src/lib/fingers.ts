const down = new Set<number>();

/**
 * Touch points on the screen now, so a one-finger long press stands down once another finger joins: a three-finger
 * hold opens Feedback, and two fingers pinch. The first finger of a new gesture starts the count over, so a lift the
 * page never heard, such as one over another app's sheet, cannot leave it stuck above one.
 */
export const fingers = () => down.size;

if (typeof window !== 'undefined') {
	const options = { capture: true, passive: true };
	window.addEventListener(
		'pointerdown',
		event => {
			if (event.pointerType !== 'touch') return;
			if (event.isPrimary) down.clear();
			down.add(event.pointerId);
		},
		options,
	);
	for (const type of ['pointerup', 'pointercancel'] as const) {
		window.addEventListener(type, event => down.delete(event.pointerId), options);
	}
}
