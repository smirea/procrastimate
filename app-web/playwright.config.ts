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
	webServer: {
		command: 'bun --bun run vite',
		url: `http://127.0.0.1:${PORT}/inbox`,
		reuseExistingServer: false,
		env: { API_URL: 'http://127.0.0.1:6121', CLIENT_PORT: String(PORT) },
	},
});
