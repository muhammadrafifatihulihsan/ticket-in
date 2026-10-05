import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/platform/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ||
      'postgresql://ticketin:ticketin_dev_password@localhost:5432/ticketin_db',
  },
  verbose: true,
  strict: true,
});
