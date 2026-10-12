/**
 * Preloaded by `bun test`. Tests that find Turso credentials in the environment write to that database, so a shell
 * with the prod env loaded once filled prod with test users. Refuse to start instead.
 */
export function productionTursoReason(env: Record<string, string | undefined>): string | null {
	const url = env.TURSO_DATABASE_URL ?? '';
	const marker = [env.NODE_ENV, env.ENV, env.ENVIRONMENT, env.ENV_MANAGER_ENV]
		.map(value => value?.toLowerCase())
		.find(value => value === 'prod' || value === 'production');
	if (url.includes('-prod') || (marker && url)) {
		return `Refusing to run tests against a production Turso database (${url || marker}). Unset TURSO_* first.`;
	}
	return null;
}

const reason = productionTursoReason(process.env);
if (reason) {
	console.error(reason);
	process.exit(1);
}
