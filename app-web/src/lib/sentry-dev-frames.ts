import type { ErrorEvent } from '@sentry/sveltekit';

/**
 * The Vite dev server serves each module transformed, which moves its lines, with its source map inline. Sentry cannot
 * fetch maps from a local origin, so a development event's frames are mapped here before it is sent. Builds never
 * load this module: `sentry.ts` imports it only under `import.meta.env.DEV`.
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Per generated line, the segments `[column, source, line, column]` of a v3 map, all absolute. */
type Lines = number[][][];

function decode(mappings: string): Lines {
	const lines: Lines = [];
	const state = [0, 0, 0, 0];
	for (const line of mappings.split(';')) {
		state[0] = 0;
		const segments: number[][] = [];
		for (const segment of line.split(',')) {
			if (!segment) continue;
			const fields: number[] = [];
			let value = 0;
			let shift = 0;
			for (const char of segment) {
				const digit = BASE64.indexOf(char);
				value += (digit & 31) << shift;
				if (digit & 32) {
					shift += 5;
					continue;
				}
				fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
				value = 0;
				shift = 0;
			}
			fields.forEach((delta, index) => (state[index] += delta));
			if (fields.length >= 4) segments.push(state.slice());
		}
		lines.push(segments);
	}
	return lines;
}

const maps = new Map<string, Promise<Lines | null>>();

function mapOf(url: string): Promise<Lines | null> {
	let pending = maps.get(url);
	if (!pending) {
		pending = fetch(url)
			.then(response => response.text())
			.then(code => {
				const inline = /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,(\S+)\s*$/.exec(code);
				return inline ? decode((JSON.parse(atob(inline[1])) as { mappings: string }).mappings) : null;
			})
			.catch(() => null);
		maps.set(url, pending);
	}
	return pending;
}

export async function mapDevFrames(event: ErrorEvent): Promise<ErrorEvent> {
	const frames = event.exception?.values?.flatMap(value => value.stacktrace?.frames ?? []) ?? [];
	await Promise.all(
		frames.map(async frame => {
			if (!frame.filename?.startsWith(location.origin) || !frame.lineno || !frame.colno) return;
			const segments = (await mapOf(frame.filename))?.[frame.lineno - 1];
			const column = frame.colno - 1;
			const segment = segments?.findLast(([generated]) => generated! <= column) ?? segments?.[0];
			if (!segment) return;
			frame.lineno = segment[2]! + 1;
			frame.colno = segment[3]! + 1;
		}),
	);
	return event;
}
