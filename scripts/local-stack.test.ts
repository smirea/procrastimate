import { expect, test } from 'bun:test';
import { staleDatabases } from './local-stack';

const url = (database: string) => `postgres://postgres:postgres@127.0.0.1:5440/${database}`;

test('staleDatabases keeps every database a configured URL points at and drops the renamed branch ones', () => {
	const commented = ['t3_dac5baac', 't3_investigate_database_usage', 't3_investigate_database_usage_e2e', 'legacy_e2e'];
	const urls = [url('t3_dac5baac'), 'postgresql://postgres:postgres@procrastimate-postgres:5432/legacy_e2e'];
	expect(staleDatabases(commented, urls)).toEqual([
		't3_investigate_database_usage',
		't3_investigate_database_usage_e2e',
	]);
});

test('staleDatabases keeps a database whose _powersync companion a configured URL points at', () => {
	expect(staleDatabases(['old', 'renamed'], [url('old_powersync')])).toEqual(['renamed']);
});

test('staleDatabases drops nothing while no URL names a database', () => {
	expect(staleDatabases(['old', 'renamed'], [])).toEqual([]);
});
