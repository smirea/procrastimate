import type { DurableObjectNamespace, R2Bucket } from '@cloudflare/workers-types';
import { parseSentryTarget, SENTRY_DSN, type SentryTarget } from '../../shared/sentry';
import { base64urlDecode } from './jwt';
import { generateVapidKeys, VAPID_SUBJECT, type Vapid } from './web-push';

/**
 * Every setting the server reads. A `secret` is a Worker secret that `secrets:push` uploads from env-manager, and a
 * `required` one fails every request when it is missing. A `var` is a plain value a deploy or a local run passes.
 */
const SETTINGS = {
	BETTER_AUTH_SECRET: 'required',
	VAPID_PUBLIC_KEY: 'required',
	VAPID_PRIVATE_KEY: 'required',
	ELEVENLABS_API_KEY: 'secret',
	/** Ramble's smart parse. */
	GEMINI_API_KEY: 'secret',
	/** Reads GitHub issues and pull requests, private ones included. Without it public ones are read signed out. */
	GITHUB_TOKEN: 'secret',
	/** Files the Feedback editor's posts as issues in this repository; the `smirea-ai` account's `gh` token, which can write. */
	FEEDBACK_GITHUB_TOKEN: 'secret',
	/** The one user whose feedback becomes GitHub issues: Stefan's Better Auth id. */
	FEEDBACK_GITHUB_USER_ID: 'secret',
	GOOGLE_CLIENT_ID: 'secret',
	GOOGLE_CLIENT_SECRET: 'secret',
	GOOGLE_IOS_CLIENT_ID: 'secret',
	APPLE_CLIENT_ID: 'secret',
	APPLE_CLIENT_SECRET: 'secret',
	APPLE_TEAM_ID: 'secret',
	APPLE_KEY_ID: 'secret',
	/** A PKCS8 .p8, with newlines as `\n` when the secret is a single line. */
	APPLE_PRIVATE_KEY: 'secret',
	/** `off` disables Better Auth's sign-in rate limit, for local runs that sign up many users from one address. */
	AUTH_RATE_LIMIT: 'var',
	/** `cassette` replays recorded transcripts instead of calling ElevenLabs. */
	RAMBLE_UPSTREAM: 'var',
	/** Set by `wrangler deploy --var`. See `Config.sentry`. */
	SENTRY_ENVIRONMENT: 'var',
	SENTRY_RELEASE: 'var',
} as const satisfies Record<string, 'required' | 'secret' | 'var'>;

type Setting = keyof typeof SETTINGS;
const settingsOf = (kinds: readonly string[]) =>
	(Object.keys(SETTINGS) as Setting[]).filter(key => kinds.includes(SETTINGS[key]));

export const WORKER_SECRETS = settingsOf(['required', 'secret']);
/** `secrets.ts verify` checks these before `wrangler deploy`. */
export const REQUIRED_WORKER_SECRETS = settingsOf(['required']);

/**
 * Raw Worker bindings. Every field is optional because Bun serves the same handler without the Cloudflare ones.
 * Read the settings through `config(env)`, which decides what is required.
 */
export type Env = { [K in Setting]?: string } & {
	/** The `App` Durable Object, which holds the database and serves `/api/*` on the Worker. */
	APP?: DurableObjectNamespace;
	RAMBLE?: DurableObjectNamespace;
	BACKUPS?: R2Bucket;
};

/** The auth secret every local run shares, the Bun server, `wrangler dev`, and tests alike. */
const LOCAL_AUTH_SECRET = 'insecure-local-dev-better-auth-secret-0123456789';

let localVapid: ReturnType<typeof generateVapidKeys> | undefined;

/**
 * `env` with what env-manager leaves empty in a local run filled in: a fixed auth secret, no sign-in rate limit, and a
 * VAPID pair made once per process. Local sign-ups come in bursts from one address: every smoke run, every e2e
 * worker, every agent's test user.
 */
export async function withLocalStandIns<T extends Env>(env: T): Promise<T> {
	const filled = { ...env, BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET || LOCAL_AUTH_SECRET };
	filled.AUTH_RATE_LIMIT ||= 'off';
	if (!filled.VAPID_PUBLIC_KEY || !filled.VAPID_PRIVATE_KEY) {
		localVapid ??= generateVapidKeys();
		const keys = await localVapid;
		filled.VAPID_PUBLIC_KEY = keys.publicKey;
		filled.VAPID_PRIVATE_KEY = keys.privateKey;
	}
	return filled;
}

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
	/** A token for GitHub's API. Null reads public repos signed out, and private ones not at all. */
	githubToken: string | null;
	/** Feedback filed as GitHub issues (`feedback-issues.ts`), for `userId` alone. Null turns the Share entry off. */
	feedbackGithub: { token: string; userId: string } | null;
	/** Reporting to `procrastimate-worker`, on only where the deploy passes `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE`. */
	sentry: SentryTarget | null;
};

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
	const read = (key: Setting) => env[key]?.trim() || null;
	const group = <K extends Setting>(keys: readonly K[], required: boolean): Record<K, string> | null => {
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

	const feedbackGithub = group(['FEEDBACK_GITHUB_TOKEN', 'FEEDBACK_GITHUB_USER_ID'], false);

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
		githubToken: read('GITHUB_TOKEN'),
		feedbackGithub: feedbackGithub && {
			token: feedbackGithub.FEEDBACK_GITHUB_TOKEN,
			userId: feedbackGithub.FEEDBACK_GITHUB_USER_ID,
		},
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
