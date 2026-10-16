import type { Env } from './bindings';
import type { TursoTarget } from './db/turso';
import { VAPID_SUBJECT, type Vapid } from './web-push';

/** Ephemeral runs keep their users in memory, so a public secret signs nothing that outlives the process. */
export const EPHEMERAL_AUTH_SECRET = 'ephemeral-better-auth-secret-0123456789';

/** A deploy without any of these fails every request. `secrets.ts verify` checks them before `wrangler deploy`. */
export const REQUIRED_WORKER_SECRETS = [
	'BETTER_AUTH_SECRET',
	'TURSO_DATABASE_URL',
	'TURSO_AUTH_TOKEN',
	'VAPID_PUBLIC_KEY',
	'VAPID_PRIVATE_KEY',
] as const;

export type AppleSecret = { kind: 'stored'; jwt: string } | { kind: 'key'; teamId: string; keyId: string; pem: string };

export type Config = {
	/**
	 * `EPHEMERAL=1`, set by unit tests, the end-to-end runs, and the Bun dev server without Turso. Data lives in
	 * memory or the Durable Object, Turso is never touched even when the shell has its secrets, and only the
	 * production secrets become optional. Production never sets it.
	 */
	ephemeral: boolean;
	authSecret: string;
	/** Null only when ephemeral. */
	turso: TursoTarget | null;
	/** Null only when ephemeral. */
	vapid: Vapid | null;
	google: { web: { clientId: string; clientSecret: string } | null; iosClientId: string | null };
	apple: { servicesId: string | null; secret: AppleSecret } | null;
	ramble: { kind: 'cassette' } | { kind: 'elevenlabs'; apiKey: string } | null;
};

type Key = Exclude<keyof Env, 'ACCOUNT'>;

export function parseConfig(env: Env): Config {
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

	const mode = read('EPHEMERAL');
	if (mode && mode !== '1') problems.push(`EPHEMERAL must be 1 or unset, not "${mode}"`);
	const ephemeral = mode === '1';

	const authSecret = ephemeral
		? (read('BETTER_AUTH_SECRET') ?? EPHEMERAL_AUTH_SECRET)
		: group(['BETTER_AUTH_SECRET'], true)?.BETTER_AUTH_SECRET;

	const tursoKeys = ephemeral ? null : group(['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'], true);
	if (tursoKeys && !URL.canParse(tursoKeys.TURSO_DATABASE_URL)) problems.push('TURSO_DATABASE_URL is not a URL');

	const vapidKeys = group(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'], !ephemeral);

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

	if (problems.length || !authSecret) {
		throw new Error(`Invalid server configuration:\n${problems.map(problem => `- ${problem}`).join('\n')}`);
	}
	return {
		ephemeral,
		authSecret,
		turso: tursoKeys && { url: tursoKeys.TURSO_DATABASE_URL, authToken: tursoKeys.TURSO_AUTH_TOKEN },
		vapid: vapidKeys && {
			publicKey: vapidKeys.VAPID_PUBLIC_KEY,
			privateKey: vapidKeys.VAPID_PRIVATE_KEY,
			subject: VAPID_SUBJECT,
		},
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
