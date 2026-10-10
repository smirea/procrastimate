import { defineConfig, devices } from '@playwright/test';

const PORT = 6130;

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
			testIgnore: '**/mobile.e2e.ts',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
		},
		{ name: 'mobile', testMatch: '**/mobile.e2e.ts', use: devices['iPhone 15 Pro'] },
	],
	// E2E_WORKER=1 tests the deployable Worker against an existing `bun run build` instead of the dev server.
	webServer:
		process.env.E2E_WORKER === '1'
			? {
					command: `bunx wrangler dev --port ${PORT}`,
					cwd: '..',
					url: `http://127.0.0.1:${PORT}/api/status`,
					reuseExistingServer: false,
				}
			: {
					command: 'bun --bun run vite',
					url: `http://127.0.0.1:${PORT}/inbox`,
					reuseExistingServer: false,
					env: { API_URL: 'http://127.0.0.1:6121', CLIENT_PORT: String(PORT) },
				},
});
