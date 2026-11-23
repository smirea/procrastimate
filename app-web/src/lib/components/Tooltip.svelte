<script lang="ts">
	import { tick } from 'svelte';
	import { placeTooltip, tooltipFor } from '../tooltip.ts';

	/** The first tooltip waits for the pointer to settle; moving straight to the next control shows its tooltip at once. */
	const DELAY_MS = 500;
	const WARM_MS = 400;

	let tip: HTMLElement;
	let text = $state('');
	let shown = $state(false);
	let position = $state({ top: 0, left: 0, below: true });

	let anchor: HTMLElement | null = null;
	/** A pressed control shows no tooltip until the pointer leaves it, so a menu it opens is not covered. */
	let pressed: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closing: ReturnType<typeof setTimeout> | undefined;
	let frame = 0;
	let warmUntil = 0;
	let placedAt = '';

	function hide() {
		clearTimeout(timer);
		clearTimeout(closing);
		cancelAnimationFrame(frame);
		if (anchor?.getAttribute('aria-describedby') === 'app-tooltip') anchor.removeAttribute('aria-describedby');
		if (shown) warmUntil = performance.now() + WARM_MS;
		anchor = null;
		shown = false;
		closing = setTimeout(() => {
			if (!shown && tip.matches(':popover-open')) tip.hidePopover();
		}, 160);
	}

	function schedule(next: { anchor: HTMLElement; text: string }, immediate = false) {
		hide();
		anchor = next.anchor;
		const wait = immediate || performance.now() < warmUntil ? 0 : DELAY_MS;
		timer = setTimeout(() => void show(next), wait);
	}

	async function show(next: { anchor: HTMLElement; text: string }) {
		clearTimeout(closing);
		text = next.text;
		await tick();
		if (anchor !== next.anchor || !anchor.isConnected) return;
		if (next.text !== anchor.getAttribute('aria-label') && !anchor.hasAttribute('aria-describedby')) anchor.setAttribute('aria-describedby', 'app-tooltip');
		// A popover in the top layer, reopened each time so it lands above any menu or panel opened since.
		if (tip.matches(':popover-open')) tip.hidePopover();
		tip.showPopover();
		placedAt = '';
		follow();
		shown = true;
	}

	/** Tracks the anchor while shown, so a tooltip follows a moving row and leaves with a control that is removed. */
	function follow() {
		if (!anchor?.isConnected) return hide();
		const rect = anchor.getBoundingClientRect();
		const key = `${rect.left},${rect.top},${rect.width},${rect.height}`;
		if (key !== placedAt) {
			placedAt = key;
			position = placeTooltip(rect, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: innerWidth, height: innerHeight });
		}
		frame = requestAnimationFrame(follow);
	}

	function onpointerover(event: PointerEvent) {
		if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return;
		const found = tooltipFor(event.target);
		if (found?.anchor !== pressed) pressed = null;
		if (found?.anchor === anchor) return;
		if (!found || found.anchor === pressed) return hide();
		schedule(found);
	}

	function onpointerout(event: PointerEvent) {
		if (event.relatedTarget === null) {
			pressed = null;
			hide();
		}
	}

	function onpointerdown(event: PointerEvent) {
		pressed = event.target instanceof Element ? (tooltipFor(event.target)?.anchor ?? null) : null;
		hide();
	}

	/** Keyboard focus shows it too, on devices that can hover, so a focus ring on an icon says what it does. */
	function onfocusin(event: FocusEvent) {
		if (!(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible') || !matchMedia('(hover: hover)').matches) return;
		const found = tooltipFor(event.target);
		if (found && found.anchor === event.target) schedule(found, true);
	}

	function onfocusout(event: FocusEvent) {
		if (event.target === anchor) hide();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') hide();
	}
</script>

<svelte:document {onpointerover} {onpointerout} {onpointerdown} {onfocusin} {onfocusout} {onkeydown} onscrollcapture={hide} />
<svelte:window onwheel={hide} onresize={hide} onblur={hide} />

<div
	bind:this={tip}
	id="app-tooltip"
	popover="manual"
	role="tooltip"
	class="tip glass-strong pointer-events-none fixed top-0 left-0 z-[100] max-w-72 rounded-lg px-2 py-1 text-[12px] leading-4 text-ink"
	class:shown
	class:below={position.below}
	style:translate={`${position.left}px ${position.top}px`}
	aria-hidden={!shown}
>
	{text}
</div>

<style>
	.tip {
		inset: 0 auto auto 0;
		margin: 0;
		border: 0;
		overflow: visible;
		opacity: 0;
		scale: 0.96;
		transform-origin: top center;
		transition:
			opacity 120ms,
			scale 160ms var(--ease-spring);
	}

	.tip:not(.below) {
		transform-origin: bottom center;
	}

	.tip.shown {
		opacity: 1;
		scale: 1;
	}

	@starting-style {
		.tip.shown {
			opacity: 0;
			scale: 0.96;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tip {
			transition: none;
		}
	}
</style>
