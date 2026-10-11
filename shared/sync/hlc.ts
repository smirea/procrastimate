/**
 * Hybrid logical clocks, written `<wall ms>:<counter>:<node>` and compared as that tuple. `node` is the
 * device id, or `server` for the server's own writes, so two clocks are never equal across devices.
 */
export type Hlc = string;

export type Clock = { wall: number; counter: number; node: string };

export const SERVER_NODE = 'server';

export const createClock = (node: string): Clock => ({ wall: 0, counter: 0, node });

export const formatHlc = (clock: Clock): Hlc => `${clock.wall}:${clock.counter}:${clock.node}`;

export function parseHlc(hlc: Hlc): Clock {
	const first = hlc.indexOf(':');
	const second = hlc.indexOf(':', first + 1);
	return {
		wall: Number(hlc.slice(0, first)),
		counter: Number(hlc.slice(first + 1, second)),
		node: hlc.slice(second + 1),
	};
}

/** Rejects a wall time or counter past `Number.MAX_SAFE_INTEGER`, which would round and stop ticking. */
export function isHlc(value: string): boolean {
	const match = /^(\d+):(\d+):(.+)$/.exec(value);
	return !!match && Number.isSafeInteger(Number(match[1])) && Number.isSafeInteger(Number(match[2]));
}

export function compareClocks(a: Clock, b: Clock): number {
	return a.wall - b.wall || a.counter - b.counter || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0);
}

export const compareHlc = (a: Hlc, b: Hlc) => compareClocks(parseHlc(a), parseHlc(b));

/** The clock for the next local write: the wall time when it moved past the last one, else one more count. */
export function tick(clock: Clock, now: number): Clock {
	return now > clock.wall ? { ...clock, wall: now, counter: 0 } : { ...clock, counter: clock.counter + 1 };
}

/** Moves the clock up to a clock seen elsewhere, so the next `tick` issues a later one. */
export function observe(clock: Clock, hlc: Hlc): Clock {
	const seen = parseHlc(hlc);
	const later = seen.wall > clock.wall || (seen.wall === clock.wall && seen.counter > clock.counter);
	return later ? { ...clock, wall: seen.wall, counter: seen.counter } : clock;
}
