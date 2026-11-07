import { expect } from 'bun:test';
import * as order from './order.ts';
import { project } from './testing.ts';
import { describe, recorded, test } from './vectors/record.ts';

const moveOrders = recorded('order', order.moveOrders);

const at = (id: string, position: number, createdAt = 0) => project(id, { order: position, createdAt });

describe('moveOrders', () => {
	test('a move writes only the moved sibling, between its new neighbors', () => {
		const siblings = [at('a', 0), at('b', 1), at('c', 2)];
		expect(moveOrders(siblings, 'c', 0)).toEqual([{ id: 'c', order: -1 }]);
		expect(moveOrders(siblings, 'a', 2)).toEqual([{ id: 'a', order: 3 }]);
		expect(moveOrders(siblings, 'a', 1)).toEqual([{ id: 'a', order: 1.5 }]);
	});

	test('a move to where it already is writes nothing, and an unknown id moves nothing', () => {
		const siblings = [at('a', 0), at('b', 1)];
		expect(moveOrders(siblings, 'b', 1)).toEqual([]);
		expect(moveOrders(siblings, 'z', 0)).toEqual([]);
		expect(moveOrders([at('a', 5)], 'a', 0)).toEqual([]);
	});

	test('a gap too small to split renumbers every sibling out of place', () => {
		const siblings = [at('a', 0), at('b', 1e-10), at('c', 2)];
		expect(moveOrders(siblings, 'c', 1)).toEqual([
			{ id: 'c', order: 1 },
			{ id: 'b', order: 2 },
		]);
	});

	test('ties settle by creation, then id', () => {
		const siblings = [at('b', 0, 1), at('a', 0, 1), at('c', 0, 0)];
		expect(moveOrders(siblings, 'c', 2)).toEqual([{ id: 'c', order: 1 }]);
	});
});
