import { describe, expect, test } from 'bun:test';
import { remoteDatabaseReason } from './test-guard';

describe('remoteDatabaseReason', () => {
	test('allows no database and the local Docker Postgres', () => {
		expect(remoteDatabaseReason({})).toBeNull();
		expect(remoteDatabaseReason({ DATABASE_URL: '' })).toBeNull();
		expect(remoteDatabaseReason({ DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5440/wt_e2e' })).toBeNull();
		expect(remoteDatabaseReason({ DATABASE_URL: 'postgres://u:p@localhost:5432/app' })).toBeNull();
	});

	test('refuses a remote database', () => {
		expect(
			remoteDatabaseReason({
				DATABASE_URL: 'postgres://postgres.x:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
			}),
		).toBe(
			'Refusing to run tests against a remote database (aws-0-us-east-1.pooler.supabase.com). Unset DATABASE_URL or point it at the local Docker Postgres.',
		);
	});

	test('refuses a value that is not a URL', () => {
		expect(remoteDatabaseReason({ DATABASE_URL: 'not a url' })).toBe(
			'Refusing to run tests: DATABASE_URL is not a URL (not a url).',
		);
	});
});
