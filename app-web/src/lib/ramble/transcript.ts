export function joinTranscript(committed: string, partial: string): { text: string; partialStart: number } {
	const tail = partial.trim();
	if (!committed) return { text: tail, partialStart: 0 };
	if (!tail) return { text: committed, partialStart: committed.length };
	const gap = committed.endsWith(' ') || tail.startsWith(' ') ? '' : ' ';
	return { text: committed + gap + tail, partialStart: committed.length + gap.length };
}
