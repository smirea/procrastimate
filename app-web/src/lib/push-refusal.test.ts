import { expect, test } from 'bun:test';
import { isPushRefusal, refusalOver, refusedRecently } from './push-refusal.ts';

const HOUR = 60 * 60 * 1000;
const refusedAt = String(Date.UTC(2026, 9, 14, 10));
const after = (hours: number) => Number(refusedAt) + hours * HOUR;

test('a push service refusal holds for a day, then asks once more', () => {
	expect(refusedRecently(refusedAt, after(1))).toBe(true);
	expect(refusalOver(refusedAt, after(1))).toBe(false);
	expect(refusedRecently(refusedAt, after(25))).toBe(false);
	expect(refusalOver(refusedAt, after(25))).toBe(true);
});

test('with no refusal stored, nothing waits and nothing asks again', () => {
	expect(refusedRecently(null, after(1))).toBe(false);
	expect(refusalOver(null, after(1))).toBe(false);
});

test('only the push service’s AbortError counts as a refusal', () => {
	expect(isPushRefusal(new DOMException('Registration failed - push service error', 'AbortError'))).toBe(true);
	expect(isPushRefusal(new DOMException('Permission denied', 'NotAllowedError'))).toBe(false);
	expect(isPushRefusal(new Error('AbortError'))).toBe(false);
});
