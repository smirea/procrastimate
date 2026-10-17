import { defineConfig, devices } from '@playwright/test';

// Offset from the dev ports so the suite runs beside `bun run start`; worktrees move CLIENT_PORT via .env.override.
const PORT = Number(process.env.CLIENT_PORT || 6120) + 10;
const API_PORT = PORT + 1;
// An empty variable in the process env wins over `--env-file`, so a developer's `development` never reports a test.
const NO_SENTRY = { SENTRY_ENVIRONMENT: '', SENTRY_RELEASE: '' };

export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: true,
	reporter: [['list']],
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		timezoneId: 'UTC',
		trace: 'retain-on-failure',
	},
	projects: [
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
		},
	],
	// E2E_WORKER=1 tests the deployable Worker against an existing `bun run build` instead of the dev server.
	webServer:
		process.env.E2E_WORKER === '1'
			? {
					command: `bunx wrangler dev --port ${PORT} --var RAMBLE_UPSTREAM:cassette --var EPHEMERAL:1`,
					cwd: '..',
					url: `http://127.0.0.1:${PORT}/api/status`,
					reuseExistingServer: false,
				}
			: [
					{
						command: 'bun src/index.ts',
						cwd: '../server',
						url: `http://127.0.0.1:${API_PORT}/api/status`,
						reuseExistingServer: false,
						env: {
							API_PORT: String(API_PORT),
							RAMBLE_UPSTREAM: 'cassette',
							EPHEMERAL: '1',
							...NO_SENTRY,
						},
					},
					{
						command: 'bun --bun run vite',
						url: `http://127.0.0.1:${PORT}/inbox`,
						reuseExistingServer: false,
						env: { API_URL: `http://127.0.0.1:${API_PORT}`, CLIENT_PORT: String(PORT), ...NO_SENTRY },
					},
				],
});
