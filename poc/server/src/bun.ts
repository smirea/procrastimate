import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createApp } from './app';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/app';
const db = drizzle(postgres(url));
await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
const port = Number(process.env.PORT ?? 58081);
const handle = createApp({
	db,
	powersyncUrl: process.env.POWERSYNC_URL ?? 'http://127.0.0.1:58080',
	baseURL: `http://127.0.0.1:${port}`,
	secret: 'poc-secret-poc-secret-poc-secret-poc',
});
Bun.serve({ port, idleTimeout: 0, fetch: handle });
console.log(`poc server on ${port}`);
