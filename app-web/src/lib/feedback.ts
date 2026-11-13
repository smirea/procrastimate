import { githubIcon, setupFeedbackEngine, type FeedbackEngine, type Webhook } from '@stefan.inc/feedback-engine/svelte';
import { page } from '$app/state';
import { api } from './api.ts';
import { localDatabase } from './database.ts';
import { session } from './session.svelte.ts';
import { sheets } from './sheets.svelte.ts';
import { store } from './store.svelte.ts';

type SyncStatus = Parameters<Parameters<typeof localDatabase.onStatus>[0]>[0];

let engine: FeedbackEngine | undefined;

/**
 * Feedback in every build, as on iOS: Alt+Meta+click opens the editor on what was clicked, and on a phone the
 * package's own three-finger hold does. Its ProcrastiMate entry and GitHub Issue webhook post to this origin's own API with the session
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
	return () => {
		stopStatus();
		engine?.destroy();
		engine = undefined;
	};
}

/** The phone's trigger, which has no modifier keys: a few seconds to reach the screen, then a capture. */
export function feedbackCountdown() {
	engine?.countdown();
}
