import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

/** `bun --env-file=.env.local run playwright test -c perf` from app-web, after `bun run build` for the Worker mode. */
export default defineConfig({
	...base,
	testDir: '.',
	testMatch: '**/*.perf.ts',
	fullyParallel: false,
	workers: 1,
	projects: [base.projects![0]!],
	webServer: [base.webServer!].flat().map(server => ({ ...server, cwd: server.cwd ? `../${server.cwd}` : '..' })),
});
