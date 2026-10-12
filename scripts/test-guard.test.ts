import { expect, test } from 'bun:test';
import { productionTursoReason } from './test-guard.ts';

test('a production Turso URL is refused', () => {
	expect(productionTursoReason({ TURSO_DATABASE_URL: 'libsql://procrastinate-prod-foo.turso.io' })).toContain(
		'Refusing to run tests',
	);
});

test('a prod environment with any database URL is refused', () => {
	expect(productionTursoReason({ TURSO_DATABASE_URL: 'libsql://x.turso.io', ENV_MANAGER_ENV: 'prod' })).toContain(
		'Refusing to run tests',
	);
	expect(productionTursoReason({ TURSO_DATABASE_URL: 'libsql://x.turso.io', NODE_ENV: 'production' })).toContain(
		'Refusing to run tests',
	);
});

test('dev, and a prod marker with no URL, are allowed', () => {
	expect(productionTursoReason({ TURSO_DATABASE_URL: 'libsql://procrastinate-dev.turso.io', ENV: 'dev' })).toBeNull();
	expect(productionTursoReason({ ENV_MANAGER_ENV: 'prod' })).toBeNull();
	expect(productionTursoReason({})).toBeNull();
});
