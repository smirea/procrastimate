export const DOT = 4;

/**
 * Bar sizes for the Ramble waveform. The newest level sits in the middle and older levels ripple out to both edges,
 * so speech reads as a pulse from the centre. Levels are mic peaks from 0 to 1; the square root lifts quiet speech.
 * `presence` fades from 1 while listening to 0 at rest, where every bar is a dot. `RambleWaveform` in Swift matches.
 */
export function waveHeights(
	history: ArrayLike<number>,
	{ bars, height, presence }: { bars: number; height: number; presence: number },
): { size: number; alpha: number }[] {
	const centre = (bars - 1) / 2;
	return Array.from({ length: bars }, (_, i) => {
		const distance = centre ? Math.abs(i - centre) / centre : 0;
		const age = Math.round(distance * (history.length - 1));
		const loud = Math.min(1, Math.sqrt(history[history.length - 1 - age] ?? 0) * 1.6);
		const taper = 1 - distance * distance * 0.55;
		return {
			size: DOT + loud * (height - DOT) * taper * presence,
			alpha: (0.3 + 0.7 * (1 - distance)) * (0.35 + 0.65 * presence),
		};
	});
}
