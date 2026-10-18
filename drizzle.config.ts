import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: ['./shared/db/schema.ts', './server/src/db/auth-schema.ts'],
	out: './server/drizzle',
});
