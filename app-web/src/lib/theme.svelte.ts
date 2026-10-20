import { MediaQuery } from 'svelte/reactivity';
import { DEVICE_KEYS } from './device.ts';
import { themeChoices, type ThemeChoice } from 'shared/theme.ts';
import { accentChoiceSchema, DEFAULT_ACCENT, type AccentChoice } from 'shared/accents.ts';

export { themeChoices, type ThemeChoice };
export type Theme = Exclude<ThemeChoice, 'system'>;

/** The pre-paint script in `app.html` repeats the keys and these colors, which match `--canvas` in `index.css`. */
const STORAGE_KEY = DEVICE_KEYS.theme;
const ACCENT_KEY = DEVICE_KEYS.accent;
const CHROME: Record<Theme, string> = { light: '#f6f6f7', dark: '#0e0e10' };

const prefersDark = new MediaQuery('prefers-color-scheme: dark');

function readChoice(): ThemeChoice {
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function readAccent(): AccentChoice {
	return accentChoiceSchema.safeParse(localStorage.getItem(ACCENT_KEY)).data ?? DEFAULT_ACCENT;
}

/** Device preferences, kept apart from the task store so they never sync. The default stores nothing. */
class ThemeState {
	choice = $state<ThemeChoice>(readChoice());
	accent = $state<AccentChoice>(readAccent());
	resolved: Theme = $derived(this.choice === 'system' ? (prefersDark.current ? 'dark' : 'light') : this.choice);

	choose(choice: ThemeChoice) {
		this.choice = choice;
		if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, choice);
	}

	chooseAccent(accent: AccentChoice) {
		this.accent = accent;
		if (accent === DEFAULT_ACCENT) localStorage.removeItem(ACCENT_KEY);
		else localStorage.setItem(ACCENT_KEY, accent);
	}
}

export const theme = new ThemeState();

/** Mirrors the resolved theme and the accent onto `<html>`, crossfading when the browser supports view transitions. */
export function applyTheme(next: Theme, accent: AccentChoice) {
	const root = document.documentElement;
	const paint = () => {
		root.dataset.theme = next;
		root.dataset.accent = accent;
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[next]);
	};
	const animate =
		(root.dataset.theme !== next || root.dataset.accent !== accent) &&
		'startViewTransition' in document &&
		!matchMedia('(prefers-reduced-motion: reduce)').matches;
	// A second change mid-crossfade skips the first, which rejects its `ready` with an AbortError.
	if (animate) document.startViewTransition(paint).ready.catch(() => {});
	else paint();
}
