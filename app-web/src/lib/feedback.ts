import { githubIcon, setupFeedbackEngine, type FeedbackEngine, type Webhook } from '@stefan.inc/feedback-engine/svelte';
import { page } from '$app/state';
import { api } from './api.ts';
import { localDatabase } from './database.ts';
import { session } from './session.svelte.ts';
import { sheets } from './sheets.svelte.ts';
import { store } from './store.svelte.ts';

type SyncStatus = Parameters<Parameters<typeof localDatabase.onStatus>[0]>[0];

let engine: FeedbackEngine | undefined;

const HOLD_FINGERS = 3;
const HOLD_MS = 600;
const SLOP_PX = 12;

/**
 * Three fingers held still anywhere capture the screen under them, the phone's stand-in for Alt+Meta+click. One finger
 * holds for the row menu and two pinch, so three is free.
 */
function holdThreeFingers(open: () => void): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let start: { x: number; y: number }[] = [];
	const cancel = () => {
		clearTimeout(timer);
		timer = undefined;
	};
	const points = (touches: TouchList) => [...touches].map(touch => ({ x: touch.clientX, y: touch.clientY }));
	const listeners = new AbortController();
	const options = { capture: true, signal: listeners.signal };
	window.addEventListener(
		'touchstart',
		event => {
			cancel();
			if (event.touches.length !== HOLD_FINGERS) return;
			// Keeps Safari from zooming or offering its edit menu under the gesture.
			event.preventDefault();
			start = points(event.touches);
			timer = setTimeout(() => {
				timer = undefined;
				navigator.vibrate?.(10);
				open();
			}, HOLD_MS);
		},
		{ ...options, passive: false },
	);
	window.addEventListener(
		'touchmove',
		event => {
			if (timer === undefined) return;
			const moved = points(event.touches).some((point, i) => {
				const from = start[i];
				return !from || Math.hypot(point.x - from.x, point.y - from.y) > SLOP_PX;
			});
			if (moved) cancel();
		},
		{ ...options, passive: true },
	);
	window.addEventListener('touchend', cancel, { ...options, passive: true });
	window.addEventListener('touchcancel', cancel, { ...options, passive: true });
	return () => {
		cancel();
		listeners.abort();
	};
}

/**
 * Feedback in every build, as on iOS: Alt+Meta+click opens the editor on what was clicked, and on a phone so does a
 * three-finger hold. Its ProcrastiMate entry and GitHub Issue webhook post to this origin's own API with the session
 * cookie, so they need no token or proxy.
 */
export function startFeedback(): () => void {
	let sync: SyncStatus | undefined;
	const stopStatus = localDatabase.onStatus(status => (sync = status));
	// The editor reads the list each time its Share menu opens, so the entry the server allows can join it later.
	const webhooks: Webhook[] = [];
	engine = setupFeedbackEngine({
		app: 'ProcrastiMate',
		version: __APP_VERSION__,
		procrastimate: { url: '', app: location.origin },
		webhooks,
	});
	void api.feedback
		.github()
		.then(({ enabled }) => {
			if (enabled) webhooks.push({ name: 'GitHub Issue', url: '/api/feedback/issues', image: githubIcon });
		})
		.catch(() => {});
	engine.context('Session', () => ({
		api: `${location.origin}/api`,
		signedIn: session.state === 'in',
		user: session.userId,
	}));
	engine.context('Sync', () => ({
		online: navigator.onLine,
		live: sync?.live,
		pendingWrites: sync?.pending,
		lastError: sync?.lastError,
		rejected: sync?.rejected.length,
	}));
	engine.context('Navigation', () => ({ route: page.url.pathname + page.url.search, sheet: sheets.current.kind }));
	engine.context('Store', () => ({
		loaded: store.loaded,
		tasks: store.tasks.length,
		projects: store.projects.length,
		sections: store.sections.length,
		labels: store.labels.length,
		comments: store.comments.length,
	}));
	const stopHold = holdThreeFingers(() => void engine?.present());
	return () => {
		stopHold();
		stopStatus();
		engine?.destroy();
		engine = undefined;
	};
}

/** The phone's trigger, which has no modifier keys: a few seconds to reach the screen, then a capture. */
export function feedbackCountdown() {
	engine?.countdown();
}
