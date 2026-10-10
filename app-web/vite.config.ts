import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import env from './env.ts';

const allowedHosts = env.CLIENT_HOST ? [env.CLIENT_HOST] : undefined;

export default defineConfig({
	resolve: {
		alias: { shared: fileURLToPath(new URL('../shared', import.meta.url)) },
	},
	server: {
		host: '127.0.0.1',
		allowedHosts,
		port: env.CLIENT_PORT,
		strictPort: true,
		proxy: {
			'/api': {
				target: env.API_URL,
				changeOrigin: true,
				secure: false,
			},
		},
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter({ fallback: 'index.html' }),
		}),
	],
});
