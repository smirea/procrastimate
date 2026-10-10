import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { newId } from './id.ts';

const randomUUID = crypto.randomUUID;

afterEach(() => {
	crypto.randomUUID = randomUUID;
});

describe('newId', () => {
	test('uses crypto.randomUUID in a secure context', () => {
		crypto.randomUUID = () => '11111111-2222-4333-8444-555555555555';
		expect(newId()).toBe('11111111-2222-4333-8444-555555555555');
	});

	test('builds a v4 UUID from getRandomValues when randomUUID is missing', () => {
		// @ts-expect-error Non-secure browser contexts do not expose randomUUID.
		crypto.randomUUID = undefined;
		const fill = spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T) => {
			(array as unknown as Uint8Array).fill(0xff);
			return array;
		});
		expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
		fill.mockRestore();
	});

	test('fallback ids differ between calls', () => {
		// @ts-expect-error Non-secure browser contexts do not expose randomUUID.
		crypto.randomUUID = undefined;
		expect(newId()).not.toBe(newId());
	});
});
