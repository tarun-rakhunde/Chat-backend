import { loadConfig } from '../config';
import { PgUserRepository } from '../users/user.repository';
import { createPool } from './postgres';

/** Creates a few demo users and prints their ids, ready to paste into API calls. */
async function seed(): Promise<void> {
  const { DATABASE_URL } = loadConfig();
  const pool = createPool(DATABASE_URL);

  try {
    const users = new PgUserRepository(pool);
    for (const name of ['Alice', 'Bob', 'Carol']) {
      const user = await users.create(name);
      console.log(`${user.name.padEnd(6)} ${user.id}`);
    }
  } finally {
    await pool.end();
  }
}

seed().catch((err: unknown) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
