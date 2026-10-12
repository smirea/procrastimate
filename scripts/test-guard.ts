/**
 * Preloaded by `bun test`. Tests that find Turso credentials in the environment write to that database, so a shell
 * with the prod env loaded once filled prod with test users. Refuse to start instead.
 */
const url = process.env.TURSO_DATABASE_URL ?? '';
const env = [process.env.NODE_ENV, process.env.ENV, process.env.ENVIRONMENT, process.env.ENV_MANAGER_ENV]
	.map(value => value?.toLowerCase())
	.find(value => value === 'prod' || value === 'production');
if (url.includes('-prod') || (env && url)) {
	console.error(`Refusing to run tests against a production Turso database (${url || env}). Unset TURSO_* first.`);
	process.exit(1);
}
