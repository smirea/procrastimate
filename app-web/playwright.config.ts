import { defineConfig, devices } from '@playwright/test';

const PORT = 6130;
const API_PORT = 6131;
/** The sync setup code both e2e servers accept. The dev server's account lives in memory, so every run starts empty. */
export const SYNC_SETUP_CODE = 'e2e-setup-code';

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
			testIgnore: ['**/mobile.e2e.ts', '**/parity/**'],
			use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
		},
		{ name: 'mobile', testMatch: '**/mobile.e2e.ts', use: devices['iPhone 15 Pro'] },
		// The web half of each iOS parity pair, at the width of the iPhone simulator the XCUITests run on.
		{ name: 'parity', testMatch: '**/parity/*.e2e.ts', use: devices['iPhone 15 Pro'] },
	],
	// E2E_WORKER=1 tests the deployable Worker against an existing `bun run build` instead of the dev server.
	webServer:
		process.env.E2E_WORKER === '1'
			? {
					command: `bunx wrangler dev --port ${PORT} --var SYNC_SETUP_CODE:${SYNC_SETUP_CODE}`,
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
						env: { API_PORT: String(API_PORT), SYNC_SETUP_CODE },
					},
					{
						command: 'bun --bun run vite',
						url: `http://127.0.0.1:${PORT}/inbox`,
						reuseExistingServer: false,
						env: { API_URL: `http://127.0.0.1:${API_PORT}`, CLIENT_PORT: String(PORT) },
					},
				],
});
