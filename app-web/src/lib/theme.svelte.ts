import { MediaQuery } from 'svelte/reactivity';

export const themeChoices = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof themeChoices)[number];
export type Theme = Exclude<ThemeChoice, 'system'>;

/** The pre-paint script in `app.html` reads the same key, so keep the two in sync. */
const STORAGE_KEY = 'procrastimate-theme';

const prefersDark = new MediaQuery('prefers-color-scheme: dark');

function readChoice(): ThemeChoice {
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** A device preference, kept apart from the task store so it never syncs. */
class ThemeState {
	choice = $state<ThemeChoice>(readChoice());
	resolved: Theme = $derived(this.choice === 'system' ? (prefersDark.current ? 'dark' : 'light') : this.choice);

	choose(choice: ThemeChoice) {
		this.choice = choice;
		if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, choice);
	}
}

export const theme = new ThemeState();

/** Mirrors the resolved theme onto `<html>`, crossfading when the browser supports view transitions. */
export function applyTheme(next: Theme) {
	const root = document.documentElement;
	const paint = () => {
		root.dataset.theme = next;
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', getComputedStyle(root).getPropertyValue('--canvas').trim());
	};
	const animate =
		root.dataset.theme !== next &&
		'startViewTransition' in document &&
		!matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (animate) document.startViewTransition(paint);
	else paint();
}
