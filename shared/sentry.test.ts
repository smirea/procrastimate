import { expect, test } from 'bun:test';
import { envelopeUrl, parseDsn, parseSentryTarget } from './sentry.ts';

test('a DSN parses into its key, host with port, and project', () => {
	expect(parseDsn('https://0123abcd@o42.ingest.us.sentry.io/7')).toEqual({
		protocol: 'https',
		publicKey: '0123abcd',
		host: 'o42.ingest.us.sentry.io',
		projectId: '7',
	});
	expect(parseDsn('http://abc@127.0.0.1:9000/1')).toEqual({
		protocol: 'http',
		publicKey: 'abc',
		host: '127.0.0.1:9000',
		projectId: '1',
	});
});

test('anything but a DSN is refused', () => {
	for (const dsn of [
		'',
		'https://o42.ingest.sentry.io/7',
		'https://abc@host/',
		'ftp://abc@host/1',
		'https://abc@host/7/x',
	]) {
		expect(parseDsn(dsn)).toBeNull();
	}
});

test('envelopes go to the project ingest endpoint', () => {
	const dsn = parseDsn('https://0123abcd@o42.ingest.us.sentry.io/7');
	expect(dsn && envelopeUrl(dsn)).toBe('https://o42.ingest.us.sentry.io/api/7/envelope/');
});

test('development never reports, even with leftover DSN and release settings', () => {
	for (const release of [undefined, '', 'local-commit']) {
		expect(parseSentryTarget('not-a-dsn', { environment: 'development', release })).toEqual({
			target: null,
			problem: null,
		});
	}
});

test('production keeps reporting and requires a valid DSN and release', () => {
	const dsn = 'https://0123abcd@o42.ingest.us.sentry.io/7';
	expect(parseSentryTarget(dsn, { environment: 'production', release: 'deployed-commit' })).toEqual({
		target: { dsn, environment: 'production', release: 'deployed-commit' },
		problem: null,
	});
	expect(parseSentryTarget(dsn, { environment: 'production', release: '' }).problem).not.toBeNull();
	expect(
		parseSentryTarget('invalid', { environment: 'production', release: 'deployed-commit' }).problem,
	).not.toBeNull();
});
