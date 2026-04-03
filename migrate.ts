/**
 * migrate.ts — runs Drizzle migrations and exits cleanly.
 *
 * drizzle-kit's CLI hangs after migrating because it doesn't close the
 * postgres connection. This script runs the migration programmatically and
 * calls process.exit() when done.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('✓ Migrations applied successfully');
} catch (e) {
  console.error('Migration failed:', e);
  process.exit(1);
} finally {
  await client.end();
}

process.exit(0);
