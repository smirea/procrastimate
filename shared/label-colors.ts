import { z } from 'zod';

/**
 * The twelve colors a label can take, in the order pickers show them. Each is a key into the palette, whose light and
 * dark values are the `--label-<key>` tokens in `app-web/src/index.css`, next to every other theme color, so the
 * contrast test covers them and iOS generates them. See `docs/decisions/labels.md`.
 */
export const LABEL_COLORS = [
	'red',
	'orange',
	'amber',
	'lime',
	'green',
	'teal',
	'cyan',
	'blue',
	'indigo',
	'violet',
	'pink',
	'gray',
] as const;
export const labelColorSchema = z.enum(LABEL_COLORS).meta({ id: 'LabelColor' });
export type LabelColor = z.infer<typeof labelColorSchema>;

export const LABEL_COLOR_HINTS: Partial<Record<LabelColor, readonly string[]>> = {
	red: ['bug', 'bugs', 'urgent', 'asap', 'blocker', 'important'],
	orange: ['errand', 'errands', 'shopping', 'groceries'],
	amber: ['waiting', 'wait', 'someday', 'maybe', 'later'],
	green: ['money', 'finance', 'bills', 'health', 'gym', 'fitness', 'garden'],
	blue: ['work', 'call', 'calls', 'phone', 'email', 'meeting', 'meetings'],
	violet: ['idea', 'ideas', 'read', 'reading', 'learn'],
	pink: ['family', 'kids', 'gift', 'gifts', 'friends'],
};

const HINTED = new Map(
	Object.entries(LABEL_COLOR_HINTS).flatMap(([color, words]) =>
		words.map(word => [word, color as LabelColor] as const),
	),
);

/** Gray stays out of the hash so a new label is never the dull one by chance. */
const HASHED = LABEL_COLORS.filter(color => color !== 'gray');

/**
 * The color a label starts with: a hint when a word of its name has an obvious color, such as `bug` for red, or
 * else a stable FNV-1a hash of the lowercased name over UTF-16 code units, so every client picks the same one.
 * Labels synced before colors existed take this too. One function, so a smarter picker can replace it.
 */
export function defaultLabelColor(name: string): LabelColor {
	const key = name.trim().toLowerCase();
	for (const word of key.split(/[^\p{L}\p{N}]+/u)) {
		const hinted = HINTED.get(word);
		if (hinted) return hinted;
	}
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
	return HASHED[hash % HASHED.length]!;
}
