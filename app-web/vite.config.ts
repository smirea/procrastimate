import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import { sentryRelease } from '../scripts/sentry-release.mts';
import { parseSentryTarget, SENTRY_DSN } from '../shared/sentry.ts';
import env from './env.ts';

const allowedHosts = env.CLIENT_HOST ? [env.CLIENT_HOST] : undefined;
const sentry = parseSentryTarget(SENTRY_DSN.web, {
	environment: env.SENTRY_ENVIRONMENT,
	release: sentryRelease(env.SENTRY_ENVIRONMENT, env.SENTRY_RELEASE),
});
if (sentry.problem) throw new Error(`Invalid web Sentry configuration: ${sentry.problem}`);

export default defineConfig({
	resolve: {
		alias: { shared: fileURLToPath(new URL('../shared', import.meta.url)) },
	},
	define: { __SENTRY_TARGET__: JSON.stringify(sentry.target) },
	// The deploy uploads the maps to Sentry and deletes them, so they are never served.
	build: { sourcemap: sentry.target ? 'hidden' : false },
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
		// Only for the SvelteKit 3 navigation spans. The deploy uploads source maps with sentry-cli, and there is no
		// server code to instrument.
		sentrySvelteKit({ autoUploadSourceMaps: false, autoInstrument: false }),
		tailwindcss(),
		sveltekit({
			adapter: adapter({ fallback: 'index.html' }),
		}),
	],
});
