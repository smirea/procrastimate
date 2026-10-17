import { defineConfig } from 'vite';

export default defineConfig({
	root: __dirname,
	worker: { format: 'es' },
	optimizeDeps: { exclude: ['@journeyapps/wa-sqlite', '@powersync/web'] },
	server: { proxy: { '/api': { target: process.env.API ?? 'http://127.0.0.1:58081', ws: true } } },
	preview: { proxy: { '/api': { target: process.env.API ?? 'http://127.0.0.1:58081', ws: true } } },
});
