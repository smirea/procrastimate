import type { Attachment } from 'svelte/attachments';

export type Settle = 'expand' | 'close' | 'back';

/**
 * Where a released drag lands. `pull` is how far the finger moved, up negative, `velocity` its speed in px/ms at
 * release, `room` how far the drawer could grow, and `height` its resting height. A flick decides on its own, so
 * a short fast throw goes as far as a slow long pull.
 */
export function settle(pull: number, velocity: number, room: number, height: number): Settle {
	if (pull < -8 && (-pull > room * 0.3 || velocity < -0.5)) return 'expand';
	if (pull > 8 && (pull > height * 0.35 || velocity > 0.5)) return 'close';
	return 'back';
}

/** Past its limit the drawer gives less and less, like iOS's scroll views, and never stops dead. */
export const rubberBand = (over: number, limit = 120) => (1 - 1 / ((over * 0.55) / limit + 1)) * limit;

const SPRING = '340ms cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * Drags the bottom drawer around `node`'s handle with the finger, 1:1. Up grows it toward the top of the screen and
 * down lowers it, and on release it springs to where `settle` says. `onexpand` and `onclose` run once the drawer
 * has reached that end, so the next surface takes over from where the finger left it.
 */
export function drawerDrag(options: {
	onexpand: () => void;
	onclose: () => void;
	ontap: () => void;
}): Attachment<HTMLElement> {
	return handle => {
		const drawer = handle.closest<HTMLElement>('[role="dialog"]');
		if (!drawer) throw new Error('drawerDrag needs a handle inside a dialog');
		let start: { y: number; height: number; room: number } | null = null;
		let samples: { y: number; t: number }[] = [];
		let pull = 0;

		const apply = () => {
			if (!start) return;
			if (pull < 0) {
				const grow = -pull;
				drawer.style.height = `${start.height + (grow <= start.room ? grow : start.room + rubberBand(grow - start.room))}px`;
				drawer.style.transform = '';
			} else {
				drawer.style.height = '';
				drawer.style.transform = `translateY(${pull}px)`;
			}
		};

		const animate = (height: string, transform: string, done?: () => void) => {
			drawer.style.transition = `height ${SPRING}, transform ${SPRING}`;
			drawer.style.height = height;
			drawer.style.transform = transform;
			const finish = () => {
				drawer.removeEventListener('transitionend', finish);
				clearTimeout(timer);
				drawer.style.transition = '';
				done?.();
			};
			const timer = setTimeout(finish, 400);
			drawer.addEventListener('transitionend', finish);
		};

		const down = (event: PointerEvent) => {
			if (event.button !== 0) return;
			handle.setPointerCapture(event.pointerId);
			const height = drawer.getBoundingClientRect().height;
			const max = parseFloat(getComputedStyle(drawer).maxHeight);
			start = {
				y: event.clientY,
				height,
				room: Math.max(0, (Number.isFinite(max) ? max : window.innerHeight) - height),
			};
			samples = [{ y: event.clientY, t: event.timeStamp }];
			pull = 0;
			drawer.style.transition = '';
			drawer.style.maxHeight = 'none';
			drawer.style.height = `${height}px`;
		};

		const move = (event: PointerEvent) => {
			if (!start) return;
			pull = event.clientY - start.y;
			samples = [...samples.filter(s => event.timeStamp - s.t < 100), { y: event.clientY, t: event.timeStamp }];
			apply();
		};

		const up = (event: PointerEvent) => {
			if (!start) return;
			const { height, room } = start;
			start = null;
			const first = samples[0]!;
			const velocity = event.timeStamp > first.t ? (event.clientY - first.y) / (event.timeStamp - first.t) : 0;
			if (Math.abs(pull) < 4) {
				drawer.style.height = '';
				drawer.style.maxHeight = '';
				return options.ontap();
			}
			const where = settle(pull, velocity, room, height);
			if (where === 'expand') return animate(`${height + room}px`, '', options.onexpand);
			if (where === 'close') return options.onclose();
			animate(`${height}px`, '', () => {
				drawer.style.height = '';
				drawer.style.maxHeight = '';
			});
		};

		handle.addEventListener('pointerdown', down);
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
		handle.addEventListener('pointercancel', up);
		return () => {
			handle.removeEventListener('pointerdown', down);
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			handle.removeEventListener('pointercancel', up);
		};
	};
}
