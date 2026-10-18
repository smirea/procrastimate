import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { memoryRambleBudget, pgRambleBudget, type RambleBudget } from './ramble-budget';
import { testApp, type TestApp } from './test-app';

let app: TestApp;
beforeAll(async () => {
	app = await testApp();
});
afterAll(() => app.close());

function budgetRules(name: string, make: () => RambleBudget) {
	describe(name, () => {
		test('grants up to the limit, then nothing, and gives released seconds back', async () => {
			const budget = make();
			const day = `2026-10-${name.length}`;
			expect(await budget.reserve(day, 70)).toBe(70);
			expect(await budget.reserve(day, 50)).toBe(30);
			expect(await budget.reserve(day, 5)).toBe(0);
			await budget.release(day, 20);
			expect(await budget.reserve(day, 50)).toBe(20);
			expect(await budget.reserve('2026-11-01', 10)).toBe(10);
		});

		test('concurrent reservations never add up past the limit', async () => {
			const budget = make();
			const grants = await Promise.all(Array.from({ length: 6 }, () => budget.reserve('2026-12-24', 30)));
			expect(grants.reduce((sum, granted) => sum + granted, 0)).toBe(100);
		});
	});
}

budgetRules('memory', () => memoryRambleBudget(100));
budgetRules('postgres', () => pgRambleBudget(app.db, 100));
