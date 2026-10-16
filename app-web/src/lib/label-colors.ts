import type { LabelColor } from 'shared/label-colors.ts';

/** Points `--label-tone` and `--label-fill` at a color's tokens, which `.label-chip` and `.label-tinted` read. */
export const labelStyle = (color: LabelColor) =>
	`--label-tone: var(--label-${color}); --label-fill: var(--label-${color}-fill)`;

export const labelColorName = (color: LabelColor) => color[0]!.toUpperCase() + color.slice(1);
