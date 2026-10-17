/**
 * Sentry projects in org `self-uo7`. A DSN is public, so it is committed here; an empty one is not provisioned yet.
 * `web` is `procrastimate-web` and `worker` is `procrastimate-worker`.
 */
export const SENTRY_DSN = { web: '', worker: '' } as const;

/** The browser posts its envelopes to its own origin here, and the Worker forwards them. */
export const SENTRY_TUNNEL_PATH = '/api/sentry';

export const SENTRY_ENVIRONMENTS = ['production', 'development'] as const;
export type SentryEnvironment = (typeof SENTRY_ENVIRONMENTS)[number];

/** Where and as what a runtime reports. Null everywhere no `SENTRY_ENVIRONMENT` is set: local, PR CI, end to end. */
export type SentryTarget = { dsn: string; environment: SentryEnvironment; release: string };

export type Dsn = { protocol: 'http' | 'https'; publicKey: string; host: string; projectId: string };

/** `https://<key>@<host>/<projectId>`, the only shape Sentry hands out. `host` keeps its port. */
export function parseDsn(dsn: string): Dsn | null {
	const match = /^(https?):\/\/([0-9a-f]+)@([^/@\s]+)\/(\d+)$/.exec(dsn.trim());
	if (!match) return null;
	const [, protocol, publicKey, host, projectId] = match;
	return { protocol: protocol as Dsn['protocol'], publicKey, host, projectId };
}

/** Where Sentry ingests a project's envelopes. */
export const envelopeUrl = ({ protocol, host, projectId }: Dsn) => `${protocol}://${host}/api/${projectId}/envelope/`;

/**
 * Reporting is on only with both `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE`. Half a pair, an unknown environment,
 * or an environment for a project whose DSN is not provisioned is a problem, so the build or the Worker fails.
 */
export function parseSentryTarget(
	dsn: string,
	raw: { environment: string | null | undefined; release: string | null | undefined },
): { target: SentryTarget | null; problem: null } | { target: null; problem: string } {
	const environment = raw.environment?.trim() || null;
	const release = raw.release?.trim() || null;
	if (!environment && !release) return { target: null, problem: null };
	if (!environment || !release) {
		return { target: null, problem: 'Set both SENTRY_ENVIRONMENT and SENTRY_RELEASE or neither' };
	}
	if (!SENTRY_ENVIRONMENTS.includes(environment as SentryEnvironment)) {
		return {
			target: null,
			problem: `SENTRY_ENVIRONMENT must be ${SENTRY_ENVIRONMENTS.join(' or ')}, not "${environment}"`,
		};
	}
	if (!parseDsn(dsn))
		return { target: null, problem: 'SENTRY_ENVIRONMENT is set, but the Sentry DSN is not provisioned' };
	return { target: { dsn, environment: environment as SentryEnvironment, release }, problem: null };
}
