/**
 * Builds the client `vite preview` serves to the end-to-end suite, before Playwright starts, so a slow build on a
 * loaded machine never counts against a web server's start-up limit. With `E2E_WORKER=1` the suite serves an existing
 * `bun run build` instead, so this leaves it alone.
 */
if (process.env.E2E_WORKER !== '1') {
	const { exitCode } = Bun.spawnSync(['bun', '--bun', 'run', 'vite', 'build'], {
		cwd: `${import.meta.dir}/..`,
		// An empty variable wins over `.env.local`, so a developer's `development` never reports a test.
		env: { ...process.env, SENTRY_ENVIRONMENT: '', SENTRY_RELEASE: '' },
		stdout: 'inherit',
		stderr: 'inherit',
	});
	if (exitCode !== 0) process.exit(exitCode);
}
