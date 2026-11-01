import { expect, test } from 'bun:test';
import { refusalOver, refusedRecently, subscribe } from './push-refusal.ts';

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

const KEY = new Uint8Array(65);

function device(answer: () => Promise<PushSubscription>) {
	const stored = new Map<string, string>();
	const storage = {
		setItem: (k: string, v: string) => void stored.set(k, v),
		removeItem: (k: string) => void stored.delete(k),
	};
	return { registration: { pushManager: { subscribe: answer } as unknown as PushManager }, storage, stored };
}

test('Chrome’s push service refusal is answered as refused and starts the backoff, without throwing', async () => {
	const { registration, storage, stored } = device(() =>
		Promise.reject(new DOMException('Registration failed - push service error', 'AbortError')),
	);
	expect(await subscribe(registration, KEY, storage, after(0))).toBe('refused');
	expect([...stored]).toEqual([['procrastimate-push-refused-at', refusedAt]]);
});

test('any other subscribe failure throws and starts no backoff', async () => {
	const denied = new DOMException('Permission denied', 'NotAllowedError');
	const { registration, storage, stored } = device(() => Promise.reject(denied));
	await expect(subscribe(registration, KEY, storage, after(0))).rejects.toBe(denied);
	expect(stored.size).toBe(0);
});

test('a subscription clears an earlier refusal', async () => {
	const made = { endpoint: 'https://push.example/1' } as PushSubscription;
	const { registration, storage, stored } = device(() => Promise.resolve(made));
	stored.set('procrastimate-push-refused-at', refusedAt);
	expect(await subscribe(registration, KEY, storage, after(30))).toBe(made);
	expect(stored.size).toBe(0);
});
