import { parseSentryTarget, SENTRY_DSN, type SentryTarget } from '../../shared/sentry';
import type { Env } from './bindings';
import { base64urlDecode } from './jwt';
import { VAPID_SUBJECT, type Vapid } from './web-push';

/** A deploy without any of these fails every request. `secrets.ts verify` checks them before `wrangler deploy`. */
export const REQUIRED_WORKER_SECRETS = ['BETTER_AUTH_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const;

export type AppleSecret = { kind: 'stored'; jwt: string } | { kind: 'key'; teamId: string; keyId: string; pem: string };

export type Config = {
	authSecret: string;
	authRateLimit: boolean;
	vapid: Vapid;
	google: { web: { clientId: string; clientSecret: string } | null; iosClientId: string | null };
	apple: { servicesId: string | null; secret: AppleSecret } | null;
	ramble: { kind: 'cassette' } | { kind: 'elevenlabs'; apiKey: string } | null;
	/** Ramble's smart parse. Null answers 503, and clients keep the grammar's tasks. */
	gemini: { apiKey: string } | null;
	/** Reporting to `procrastimate-worker`, on only where the deploy passes `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE`. */
	sentry: SentryTarget | null;
};

type Key = Exclude<keyof Env, 'APP' | 'RAMBLE' | 'BACKUPS'>;

function decodedLength(text: string): number | null {
	try {
		return base64urlDecode(text).length;
	} catch {
		return null;
	}
}

function vapidProblems(publicKey: string, privateKey: string): string[] {
	const problems: string[] = [];
	const point = (() => {
		try {
			return base64urlDecode(publicKey);
		} catch {
			return null;
		}
	})();
	if (point?.length !== 65 || point[0] !== 0x04) problems.push('VAPID_PUBLIC_KEY is not an uncompressed P-256 point');
	if (decodedLength(privateKey) !== 32) problems.push('VAPID_PRIVATE_KEY is not a 32-byte P-256 scalar');
	return problems;
}

/** `sentryDsn` is the committed worker DSN; tests pass their own. */
export function parseConfig(env: Env, sentryDsn: string = SENTRY_DSN.worker): Config {
	const problems: string[] = [];
	const read = (key: Key) => env[key]?.trim() || null;
	const group = <K extends Key>(keys: readonly K[], required: boolean): Record<K, string> | null => {
		const missing = keys.filter(key => !read(key));
		if (!missing.length) return Object.fromEntries(keys.map(key => [key, read(key)])) as Record<K, string>;
		if (required) problems.push(`Missing ${missing.join(', ')}`);
		else if (missing.length < keys.length)
			problems.push(`Set all of ${keys.join(', ')} or none (missing ${missing.join(', ')})`);
		return null;
	};

	const authSecret = group(['BETTER_AUTH_SECRET'], true)?.BETTER_AUTH_SECRET;
	const rateLimit = read('AUTH_RATE_LIMIT');
	if (rateLimit && rateLimit !== 'off') problems.push(`AUTH_RATE_LIMIT must be off or unset, not "${rateLimit}"`);

	const vapidKeys = group(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'], true);
	if (vapidKeys) problems.push(...vapidProblems(vapidKeys.VAPID_PUBLIC_KEY, vapidKeys.VAPID_PRIVATE_KEY));

	const googleWeb = group(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], false);

	const appleKey = group(['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'], false);
	const pem = appleKey?.APPLE_PRIVATE_KEY.replaceAll('\\n', '\n');
	if (pem && !pem.includes('PRIVATE KEY')) problems.push('APPLE_PRIVATE_KEY is not a PKCS8 PEM');
	const appleJwt = read('APPLE_CLIENT_SECRET');
	const appleSecret: AppleSecret | null = appleJwt
		? { kind: 'stored', jwt: appleJwt }
		: appleKey && pem
			? { kind: 'key', teamId: appleKey.APPLE_TEAM_ID, keyId: appleKey.APPLE_KEY_ID, pem }
			: null;
	const servicesId = read('APPLE_CLIENT_ID');
	if (servicesId && !appleSecret) {
		problems.push('APPLE_CLIENT_ID needs APPLE_CLIENT_SECRET, or APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY');
	}

	const upstream = read('RAMBLE_UPSTREAM');
	if (upstream && upstream !== 'cassette')
		problems.push(`RAMBLE_UPSTREAM must be cassette or unset, not "${upstream}"`);
	const elevenLabsKey = read('ELEVENLABS_API_KEY');
	const geminiKey = read('GEMINI_API_KEY');

	const sentry = parseSentryTarget(sentryDsn, {
		environment: read('SENTRY_ENVIRONMENT'),
		release: read('SENTRY_RELEASE'),
	});
	if (sentry.problem) problems.push(sentry.problem);

	if (problems.length || !authSecret || !vapidKeys) {
		throw new Error(`Invalid server configuration:\n${problems.map(problem => `- ${problem}`).join('\n')}`);
	}
	return {
		authSecret,
		authRateLimit: rateLimit !== 'off',
		vapid: { publicKey: vapidKeys.VAPID_PUBLIC_KEY, privateKey: vapidKeys.VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT },
		google: {
			web: googleWeb && { clientId: googleWeb.GOOGLE_CLIENT_ID, clientSecret: googleWeb.GOOGLE_CLIENT_SECRET },
			iosClientId: read('GOOGLE_IOS_CLIENT_ID'),
		},
		apple: appleSecret && { servicesId, secret: appleSecret },
		ramble:
			upstream === 'cassette'
				? { kind: 'cassette' }
				: elevenLabsKey
					? { kind: 'elevenlabs', apiKey: elevenLabsKey }
					: null,
		gemini: geminiKey ? { apiKey: geminiKey } : null,
		sentry: sentry.target,
	};
}

const parsed = new WeakMap<Env, Config>();

/** Parsed once per bindings object, which the Worker runtime keeps for the isolate's life. */
export function config(env: Env): Config {
	const existing = parsed.get(env);
	if (existing) return existing;
	const created = parseConfig(env);
	parsed.set(env, created);
	return created;
}
