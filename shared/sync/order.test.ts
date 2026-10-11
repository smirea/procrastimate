import { describe, expect, test } from 'bun:test';
import { bySiblingOrder, MIN_ORDER_GAP, moveOrders, orderBetween } from './order.ts';

const sib = (id: string, order: number, createdAt = 1) => ({ id, order, createdAt });

describe('orderBetween', () => {
	test('takes the midpoint, or one past the only neighbor', () => {
		expect(orderBetween(1, 2)).toBe(1.5);
		expect(orderBetween(null, 2)).toBe(1);
		expect(orderBetween(4, null)).toBe(5);
		expect(orderBetween(null, null)).toBe(0);
	});
});

describe('moveOrders', () => {
	const siblings = [sib('a', 0), sib('b', 1), sib('c', 2)];

	test('writes only the moved sibling', () => {
		expect(moveOrders(siblings, 'c', 0)).toEqual([{ id: 'c', order: -1 }]);
		expect(moveOrders(siblings, 'a', 1)).toEqual([{ id: 'a', order: 1.5 }]);
		expect(moveOrders(siblings, 'a', 5)).toEqual([{ id: 'a', order: 3 }]);
	});

	test('writes nothing when the sibling stays put', () => {
		expect(moveOrders(siblings, 'b', 1)).toEqual([]);
		expect(moveOrders(siblings, 'missing', 0)).toEqual([]);
	});

	test('renumbers the siblings when the gap gets too small', () => {
		const tight = [sib('a', 0), sib('b', MIN_ORDER_GAP / 2), sib('c', 5)];
		expect(moveOrders(tight, 'c', 1)).toEqual([
			{ id: 'c', order: 1 },
			{ id: 'b', order: 2 },
		]);
	});

	test('settles a tie from two concurrent moves by creation, then id', () => {
		const tied = [sib('b', 1, 1), sib('a', 1, 1), sib('z', 1, 0)];
		expect(tied.toSorted(bySiblingOrder).map(s => s.id)).toEqual(['z', 'a', 'b']);
	});
});
