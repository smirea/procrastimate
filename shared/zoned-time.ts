import type { DateKey, TimeOfDay } from './task.ts';

const DAY = 86_400_000;

/**
 * Wall-clock dates and times in a named IANA zone, for the server, which cannot use its process zone. Without a
 * zone, each helper uses the process zone, as clients do.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
	let format = formatters.get(zone);
	if (!format) {
		format = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
		});
		formatters.set(zone, format);
	}
	return format;
}

function wallClock(at: number, zone: string) {
	const parts: Record<string, number> = {};
	for (const part of formatter(zone).formatToParts(at)) {
		if (part.type !== 'literal') parts[part.type] = Number(part.value);
	}
	return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

function offsetAt(at: number, zone: string): number {
	const wall = wallClock(at, zone);
	const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
	return asUtc - Math.floor(at / 1000) * 1000;
}

export function isTimeZone(zone: string): boolean {
	try {
		formatter(zone);
		return true;
	} catch {
		return false;
	}
}

/**
 * The moment `date` at `time` happens in `zone`, in epoch milliseconds. Like `Date` in the process zone, a time
 * skipped by a daylight saving jump lands after the jump, and a time that happens twice takes the first.
 */
export function zonedTime(date: DateKey, time: TimeOfDay, zone?: string): number {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	const [h, min] = time.split(':').map(Number) as [number, number];
	if (zone === undefined) return new Date(y, m - 1, d, h, min).getTime();
	const wall = Date.UTC(y, m - 1, d, h, min);
	// Zones change offset at most once within a day, so the offsets a day either side are the only candidates.
	const before = offsetAt(wall - DAY, zone);
	const after = offsetAt(wall + DAY, zone);
	const valid = [wall - before, wall - after].filter((at, i) => offsetAt(at, zone) === (i === 0 ? before : after));
	return valid.length ? Math.min(...valid) : wall - before;
}

/** The wall clock at `at` in `zone`, as a `Date` whose local fields read it in any process zone. */
export function wallDate(at: number, zone: string): Date {
	const wall = wallClock(at, zone);
	return new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function zonedDateKey(at: number, zone?: string): DateKey {
	if (zone === undefined) {
		const date = new Date(at);
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` as DateKey;
	}
	const wall = wallClock(at, zone);
	return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}` as DateKey;
}
