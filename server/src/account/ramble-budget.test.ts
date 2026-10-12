import { expect, test } from 'bun:test';
import { localTurso } from '../db/test-turso';
import { memoryRambleBudget, tursoRambleBudget } from './ramble-budget';

test('concurrent reserves stay inside the daily budget and release gives time back', async () => {
	const budget = memoryRambleBudget(10);
	const grants = await Promise.all([1, 2, 3, 4].map(() => budget.reserve('2026-10-14', 4)));
	expect(grants.reduce((sum, granted) => sum + granted, 0)).toBe(10);
	await budget.release('2026-10-14', 3);
	expect(await budget.reserve('2026-10-14', 4)).toBe(3);
	expect(await budget.reserve('2026-10-15', 4)).toBe(4);
});

test('the Turso budget grants only what the UTC day has left', async () => {
	const budget = tursoRambleBudget(await localTurso(), 10);
	expect(await budget.reserve('2026-10-14', 4)).toBe(4);
	expect(await budget.reserve('2026-10-14', 8)).toBe(6);
	await budget.release('2026-10-14', 3);
	expect(await budget.reserve('2026-10-14', 4)).toBe(3);
	expect(await budget.reserve('2026-10-14', 0)).toBe(0);
});
