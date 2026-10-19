import { z } from 'zod';

/**
 * The app's theme color, a device preference like the theme (see `docs/decisions/theming.md`). Each one is a vivid base
 * color; `deriveAccent` turns it into the accent and on-accent pair for each theme, so every choice meets the same
 * contrast bar the fixed accent did.
 */
export const ACCENTS = {
	frost: { name: 'Frost', base: '#3d9bff' },
	indigo: { name: 'Indigo', base: '#5b5ef7' },
	violet: { name: 'Violet', base: '#9b5cff' },
	pink: { name: 'Pink', base: '#f0479b' },
	red: { name: 'Red', base: '#ef4444' },
	orange: { name: 'Orange', base: '#ff6a3d' },
	amber: { name: 'Amber', base: '#f5a524' },
	green: { name: 'Green', base: '#22c55e' },
	teal: { name: 'Teal', base: '#14b8a6' },
	graphite: { name: 'Graphite', base: '#71717a' },
} as const;

export const accentChoiceSchema = z
	.enum(Object.keys(ACCENTS) as [keyof typeof ACCENTS, ...(keyof typeof ACCENTS)[]])
	.meta({ id: 'AccentChoice' });
export type AccentChoice = z.infer<typeof accentChoiceSchema>;
export const accentChoices = accentChoiceSchema.options;
export const DEFAULT_ACCENT: AccentChoice = 'frost';

export type Rgb = [number, number, number];
/** One theme's accent: the fill and text color, the text drawn on an accent fill, and the canvas glow's tint. */
export type AccentTokens = { accent: Rgb; onAccent: Rgb; glow: Rgb; glowAlpha: number };

type Oklch = [number, number, number];

const toLinear = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function luminance([r, g, b]: Rgb) {
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(a: Rgb, b: Rgb) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi! + 0.05) / (lo! + 0.05);
}

export function hexRgb(hex: string): Rgb {
	const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!match) throw new Error(`Not a #rrggbb color: ${hex}`);
	return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

function toOklch([r, g, b]: Rgb): Oklch {
	const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** Linear sRGB, which falls outside 0...1 when the color is out of gamut. */
function oklchLinear([L, C, h]: Oklch): Rgb {
	const [A, B] = [C * Math.cos(h), C * Math.sin(h)];
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707542331 * s,
	];
}

/** The color at this lightness and hue, keeping as much chroma as sRGB can show. */
function inGamut([L, C, h]: Oklch): Rgb {
	const fits = (c: number) => oklchLinear([L, c, h]).every(v => v >= 0 && v <= 1);
	let [lo, hi] = [0, C];
	if (!fits(hi)) {
		for (let i = 0; i < 24; i++) {
			const mid = (lo + hi) / 2;
			if (fits(mid)) lo = mid;
			else hi = mid;
		}
	} else lo = C;
	return oklchLinear([L, lo, h]).map(v => Math.round(fromLinear(Math.min(1, Math.max(0, v))))) as Rgb;
}

/** The lightness nearest `start`, moving in `direction`, whose color meets `ratio` against `against`. */
function lightnessFor(base: Oklch, start: number, direction: 1 | -1, against: Rgb, ratio: number): Rgb {
	for (let L = start; L >= 0 && L <= 1; L += direction * 0.005) {
		const rgb = inGamut([L, base[1], base[2]]);
		if (contrast(rgb, against) >= ratio) return rgb;
	}
	return direction === 1 ? [255, 255, 255] : [0, 0, 0];
}

/**
 * Accent text's hardest surface in each theme: the light canvas, and the lightest dark glass. The target leaves headroom
 * for the glows and glass composited over them; `theme-contrast.test.ts` checks every real surface, for every choice.
 */
const LIGHT_SURFACE: Rgb = [246, 246, 247];
const DARK_SURFACE: Rgb = [46, 46, 53];
const TARGET = 5.2;

export function deriveAccent(base: string): { light: AccentTokens; dark: AccentTokens } {
	const rgb = hexRgb(base);
	const lch = toOklch(rgb);
	const lightAccent = lightnessFor(lch, Math.min(lch[0], 0.7), -1, LIGHT_SURFACE, TARGET);
	const darkAccent = lightnessFor(lch, Math.max(lch[0], 0.72), 1, DARK_SURFACE, TARGET);
	return {
		light: {
			accent: lightAccent,
			onAccent: [255, 255, 255],
			glow: inGamut([0.93, Math.min(lch[1], 0.05), lch[2]]),
			glowAlpha: 0.6,
		},
		dark: { accent: darkAccent, onAccent: inGamut([0.2, Math.min(lch[1], 0.05), lch[2]]), glow: rgb, glowAlpha: 0.11 },
	};
}

const hex = (rgb: Rgb) => `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;

/** The custom properties `index.css` reads for the accent, per theme. */
export function accentProperties(tokens: AccentTokens): Record<string, string> {
	return {
		'--accent': hex(tokens.accent),
		'--on-accent': hex(tokens.onAccent),
		'--accent-glow': `rgb(${tokens.glow.join(' ')} / ${tokens.glowAlpha})`,
	};
}
