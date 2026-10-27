import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import { appVersion } from '../scripts/app-version.mts';
import { sentryRelease } from '../scripts/sentry-release.mts';
import { parseSentryTarget, SENTRY_DSN } from '../shared/sentry.ts';
import env from './env.ts';

const allowedHosts = env.CLIENT_HOST ? [env.CLIENT_HOST] : undefined;
const sentry = parseSentryTarget(SENTRY_DSN.web, {
	environment: env.SENTRY_ENVIRONMENT,
	release: sentryRelease(env.SENTRY_ENVIRONMENT, env.SENTRY_RELEASE),
});
if (sentry.problem) throw new Error(`Invalid web Sentry configuration: ${sentry.problem}`);

const DATABASE_WORKER = 'virtual:database-worker';
const WORKERS_DIR = '_app/immutable/workers';

export default defineConfig({
	resolve: {
		alias: { shared: fileURLToPath(new URL('../shared', import.meta.url)) },
	},
	define: { __SENTRY_TARGET__: JSON.stringify(sentry.target), __APP_VERSION__: JSON.stringify(appVersion()) },
	// The deploy uploads the maps to Sentry and deletes them, so they are never served.
	build: { sourcemap: sentry.target ? 'hidden' : false },
	// sync-engine runs SQLite in a module worker, and the prebundler would break sqlite-wasm's own wasm loading.
	worker: { format: 'es' },
	optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
	server: {
		host: '127.0.0.1',
		allowedHosts,
		port: env.CLIENT_PORT,
		strictPort: true,
		proxy: {
			'^/api/': {
				target: env.API_URL,
				changeOrigin: true,
				secure: false,
				ws: true,
			},
		},
	},
	plugins: [
		{
			// `E2E_WORKER=1` reads it, since a build with Sentry baked in fails every test's Sentry guard.
			name: 'sentry-build-marker',
			apply: 'build',
			buildStart() {
				mkdirSync('.svelte-kit', { recursive: true });
				writeFileSync('.svelte-kit/sentry-target.json', JSON.stringify(sentry.target));
			},
		},
		{
			// `$app/manifest` names the database worker's entry but not the chunks and wasm it loads, and the service
			// worker must precache them to open the database offline. Its build runs after the client's has been written
			// to the same `outDir`, so it lists them from there.
			name: 'database-worker-files',
			resolveId: id => (id === DATABASE_WORKER ? `\0${DATABASE_WORKER}` : undefined),
			load(id) {
				if (id !== `\0${DATABASE_WORKER}`) return;
				if (this.environment.name !== 'serviceWorker') return 'export default [];';
				const { root, build } = this.environment.config;
				const out = resolve(root, build.outDir);
				const dir = join(out, WORKERS_DIR);
				if (!existsSync(dir)) throw new Error(`No database worker build in ${dir}`);
				const files = readdirSync(dir, { recursive: true, withFileTypes: true })
					// The deploy deletes the source maps after uploading them, and a precache of a missing file fails.
					.filter(entry => entry.isFile() && /\.(js|wasm)$/.test(entry.name))
					.map(entry => `/${relative(out, join(entry.parentPath, entry.name))}`);
				// An sqlite-wasm upgrade that renames the wasm fails here rather than leave the database closed offline.
				if (!files.some(file => /\/sqlite3-[\w-]+\.wasm$/.test(file))) throw new Error(`No sqlite3 wasm in ${dir}`);
				return `export default ${JSON.stringify(files)};`;
			},
		},
		// Only for the SvelteKit 3 navigation spans. The deploy uploads source maps with sentry-cli, and there is no
		// server code to instrument.
		sentrySvelteKit({ autoUploadSourceMaps: false, autoInstrument: false }),
		tailwindcss(),
		sveltekit({
			adapter: adapter({ fallback: 'index.html' }),
		}),
	],
});
