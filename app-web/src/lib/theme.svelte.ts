import { MediaQuery } from 'svelte/reactivity';
import { DEVICE_KEYS } from './device.ts';
import { themeChoices, type ThemeChoice } from 'shared/theme.ts';
import { accentCss, DEFAULT_ACCENT, isCustomAccent, parseAccent, type Accent } from 'shared/accents.ts';

export { themeChoices, type ThemeChoice };
export type Theme = Exclude<ThemeChoice, 'system'>;

/** The pre-paint script in `app.html` repeats the keys and these colors, which match `--canvas` in `index.css`. */
const STORAGE_KEY = DEVICE_KEYS.theme;
const ACCENT_KEY = DEVICE_KEYS.accent;
/** A custom color's derived rules, so the pre-paint script can paint them without deriving. */
const ACCENT_CSS_KEY = DEVICE_KEYS.accentCss;
const CUSTOM_STYLE_ID = 'custom-accent';
const CHROME: Record<Theme, string> = { light: '#f6f6f7', dark: '#0e0e10' };

const prefersDark = new MediaQuery('prefers-color-scheme: dark');

function readChoice(): ThemeChoice {
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** Device preferences, kept apart from the task store so they never sync. The default stores nothing. */
class ThemeState {
	choice = $state<ThemeChoice>(readChoice());
	accent = $state<Accent>(parseAccent(localStorage.getItem(ACCENT_KEY)));
	resolved: Theme = $derived(this.choice === 'system' ? (prefersDark.current ? 'dark' : 'light') : this.choice);

	choose(choice: ThemeChoice) {
		this.choice = choice;
		if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, choice);
	}

	chooseAccent(accent: Accent) {
		this.accent = accent;
		if (accent === DEFAULT_ACCENT) localStorage.removeItem(ACCENT_KEY);
		else localStorage.setItem(ACCENT_KEY, accent);
		if (isCustomAccent(accent)) localStorage.setItem(ACCENT_CSS_KEY, accentCss(accent, 'custom'));
		else localStorage.removeItem(ACCENT_CSS_KEY);
	}
}

export const theme = new ThemeState();

/** A custom color's rules live in one `<style>`, which the pre-paint script may already have added. */
function paintCustom(accent: Accent) {
	let style = document.getElementById(CUSTOM_STYLE_ID);
	if (!isCustomAccent(accent)) return style?.remove();
	if (!style) {
		style = document.createElement('style');
		style.id = CUSTOM_STYLE_ID;
		document.head.append(style);
	}
	style.textContent = accentCss(accent, 'custom');
}

/**
 * Mirrors the resolved theme and the accent onto `<html>`, crossfading when the browser supports view transitions. A
 * custom color dragged through the picker repaints without one, since `data-accent` stays `custom`.
 */
export function applyTheme(next: Theme, accent: Accent) {
	const root = document.documentElement;
	const key = isCustomAccent(accent) ? 'custom' : accent;
	const paint = () => {
		root.dataset.theme = next;
		root.dataset.accent = key;
		paintCustom(accent);
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[next]);
	};
	const animate =
		(root.dataset.theme !== next || root.dataset.accent !== key) &&
		'startViewTransition' in document &&
		!matchMedia('(prefers-reduced-motion: reduce)').matches;
	// A second change mid-crossfade skips the first, which rejects its `ready` with an AbortError.
	if (animate) document.startViewTransition(paint).ready.catch(() => {});
	else paint();
}
