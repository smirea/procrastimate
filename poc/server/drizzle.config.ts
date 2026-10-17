import { defineConfig } from 'drizzle-kit';
export default defineConfig({ dialect: 'postgresql', schema: './server/src/schema.ts', out: './server/drizzle' });
