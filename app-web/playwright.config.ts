import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Offset from the dev ports so the suite runs beside `bun run start`; worktrees move CLIENT_PORT via .env.override.
const PORT = Number(process.env.CLIENT_PORT || 6120) + 10;
const API_PORT = PORT + 1;
// An empty variable in the process env wins over `--env-file`, so a developer's `development` never reports a test.
const NO_SENTRY = { SENTRY_ENVIRONMENT: '', SENTRY_RELEASE: '' };

// Before any server starts, so a build with Sentry on fails once with the fix instead of in every test.
if (process.env.E2E_WORKER === '1') {
	const marker = new URL('.svelte-kit/sentry-target.json', import.meta.url);
	const target = JSON.parse(readFileSync(marker, 'utf8')) as { environment: string } | null;
	if (target) {
		throw new Error(
			`app-web/build reports to Sentry (${target.environment}). Rebuild it with SENTRY_ENVIRONMENT= SENTRY_RELEASE= bun run build.`,
		);
	}
}

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
					// A prebuilt bundle, not the dev server: each fresh browser context made Vite serve ~600 modules, and
					// eight cold contexts at once on a busy machine took past the 5 s assertion timeout to render.
					{
						command: `bun --bun run vite build && bun --bun run vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
						url: `http://127.0.0.1:${PORT}/inbox`,
						reuseExistingServer: false,
						env: { API_URL: `http://127.0.0.1:${API_PORT}`, CLIENT_PORT: String(PORT), ...NO_SENTRY },
					},
				],
});
