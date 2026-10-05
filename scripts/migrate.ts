import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabase, db } from '../src/platform/db/client.js';

async function runMigrations(): Promise<void> {
  console.info('Starting database migration...');
  try {
    await migrate(db, { migrationsFolder: './migrations' });
    console.info('Database migrations applied successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

void runMigrations();
