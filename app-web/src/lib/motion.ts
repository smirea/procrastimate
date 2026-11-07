import { MediaQuery } from 'svelte/reactivity';

/** Matches Tailwind's `md` breakpoint, below which the sidebar becomes a drawer and sheets dock to the bottom. */
export const mobile = new MediaQuery('max-width: 767px');

const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');

/** Svelte transition params that become instant under reduced motion, which CSS cannot reach because Svelte animates from script. */
export const motion = <T extends { duration?: number }>(params: T): T =>
	reducedMotion.current ? { ...params, duration: 0 } : params;

/**
 * Attach to a list item or group that animates out: `{@attach leaving}`. A row moving between lists exists twice while it
 * animates. Svelte makes the leaving copy inert, which not every screen reader honors and Playwright's role queries
 * ignore, so this mirrors `inert` into `aria-hidden`, and Svelte clearing `inert` when the item comes back clears it too.
 */
export function leaving(node: HTMLElement) {
	const observer = new MutationObserver(() => {
		if (node.inert) node.setAttribute('aria-hidden', 'true');
		else node.removeAttribute('aria-hidden');
	});
	observer.observe(node, { attributes: true, attributeFilter: ['inert'] });
	return () => observer.disconnect();
}

/**
 * Publishes the on-screen keyboard's height as `--keyboard-inset` so bottom sheets sit above it.
 * iOS Safari overlays the keyboard instead of resizing the layout viewport, so only the visual viewport shrinks.
 */
export function trackKeyboardInset() {
	const viewport = window.visualViewport;
	if (!viewport) return;
	const update = () => {
		const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
		document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
		document.documentElement.toggleAttribute('data-keyboard', inset > 0);
	};
	update();
	viewport.addEventListener('resize', update);
	viewport.addEventListener('scroll', update);
	return () => {
		viewport.removeEventListener('resize', update);
		viewport.removeEventListener('scroll', update);
	};
}
