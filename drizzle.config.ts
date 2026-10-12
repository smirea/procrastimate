import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: ['./shared/db/schema.ts', './server/src/db/auth-schema.ts'],
	out: './server/drizzle',
});
