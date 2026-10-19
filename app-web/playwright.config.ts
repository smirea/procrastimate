import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Offset from the dev ports so the suite runs beside `bun run start`; worktrees move CLIENT_PORT via .env.override.
const PORT = Number(process.env.CLIENT_PORT || 6120) + 10;
const API_PORT = PORT + 1;
// An empty variable in the process env wins over `--env-file`, so a developer's `development` never reports a test.
const NO_SENTRY = { SENTRY_ENVIRONMENT: '', SENTRY_RELEASE: '' };

// The e2e servers share the worktree's database and PowerSync with `bun run start`; every test signs up its own users.
const overrideFile = new URL('../.env.override', import.meta.url);
const override = existsSync(overrideFile) ? readFileSync(overrideFile, 'utf8') : '';
const [DATABASE_URL, POWERSYNC_URL] = ['DATABASE_URL', 'POWERSYNC_URL'].map(
	key => override.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1],
);
if (!DATABASE_URL || !POWERSYNC_URL) {
	throw new Error('.env.override has no DATABASE_URL or POWERSYNC_URL. Run `bun scripts/setup-worktree.ts` first.');
}

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
		serviceWorkers: 'block',
	},
	projects: [
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
		},
		// The local database is SQLite in WebAssembly on IndexedDB, which WebKit runs its own way, so the specs that
		// sync also run on an iPhone-sized WebKit.
		{
			name: 'mobile',
			testMatch: ['sync.e2e.ts', 'sharing.e2e.ts', 'images.e2e.ts', 'single-origin.e2e.ts'],
			use: { ...devices['iPhone 15'], viewport: { width: 393, height: 852 } },
			// Linux WebKit on CI's two cores runs these specs about five times slower than a Mac (10 to 20 s a test against
			// 2 to 4 s), so the longer ones crossed the default limits there.
			...(process.env.CI && { timeout: 60_000, expect: { timeout: 10_000 } }),
		},
	],
	webServer:
		process.env.E2E_WORKER === '1'
			? {
					command: `bun scripts/wrangler-dev.ts --port ${PORT} --var RAMBLE_UPSTREAM:cassette`,
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
							DATABASE_URL,
							POWERSYNC_URL,
							AUTH_RATE_LIMIT: 'off',
							RAMBLE_UPSTREAM: 'cassette',
							...NO_SENTRY,
						},
					},
					// A prebuilt bundle, not the dev server: each fresh browser context made Vite serve ~600 modules, and
					// eight cold contexts at once on a busy machine took past the 5 s assertion timeout to render. The
					// preview runs on Node: under Bun its proxy crashed the server with ERR_STREAM_WRITE_AFTER_END when a
					// browser dropped a streaming PowerSync response.
					{
						command: `bun --bun run vite build && bun run vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
						url: `http://127.0.0.1:${PORT}/inbox`,
						reuseExistingServer: false,
						env: { API_URL: `http://127.0.0.1:${API_PORT}`, CLIENT_PORT: String(PORT), ...NO_SENTRY },
					},
				],
});
