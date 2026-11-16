import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config';
import { createPool, withTransaction } from './postgres';

// Same relative path from src/infra (tsx) and dist/infra (compiled).
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

/** Applies every migrations/*.sql file not yet recorded in schema_migrations, in name order. */
async function migrate(): Promise<void> {
  const { DATABASE_URL } = loadConfig();
  const pool = createPool(DATABASE_URL);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await withTransaction(pool, async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });
      console.log(`Applied ${file}`);
    }
    console.log('Database schema is up to date.');
  } finally {
    await pool.end();
  }
}

migrate().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
